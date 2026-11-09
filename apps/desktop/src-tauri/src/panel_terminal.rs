use crate::errors::DesktopFailure;
use crate::process_manager::{ProcessManager, ProcessRegistration};
use crate::workspace_panel::WorkspaceScope;
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::OsString,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

struct TerminalSession {
    scope: WorkspaceScope,
    master: Mutex<Box<dyn MasterPty + Send>>,
    reader: Mutex<Option<Box<dyn Read + Send>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    process: ProcessRegistration,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

#[derive(Default)]
pub struct TerminalState(Mutex<HashMap<String, Arc<TerminalSession>>>);

#[derive(Serialize)]
pub struct StartedTerminal {
    id: String,
    cwd: String,
}

#[derive(Clone, Serialize)]
struct TerminalOutput {
    id: String,
    scope: WorkspaceScope,
    data: String,
    closed: bool,
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(20, 400),
        rows: rows.clamp(5, 150),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn default_shell() -> OsString {
    if cfg!(windows) {
        std::env::var_os("ComSpec")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "cmd.exe".into())
    } else {
        std::env::var_os("SHELL")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "sh".into())
    }
}

fn ssh_command(target: &str) -> Result<CommandBuilder, DesktopFailure> {
    #[cfg(windows)]
    let executable =
        PathBuf::from(std::env::var_os("SystemRoot").ok_or_else(DesktopFailure::operation_failed)?)
            .join("System32")
            .join("OpenSSH")
            .join("ssh.exe");
    #[cfg(not(windows))]
    let executable = PathBuf::from("/usr/bin/ssh");
    if !executable.is_absolute() || !executable.is_file() {
        return Err(DesktopFailure::runtime_unavailable());
    }
    let mut command = CommandBuilder::new(executable);
    #[cfg(test)]
    if let Some(config) = std::env::var_os("HERMESS_TEST_SSH_CONFIG") {
        command.arg("-F");
        command.arg(config);
    }
    command.args(["-tt", "-o", "ConnectTimeout=10", "--", target]);
    Ok(command)
}

#[tauri::command]
pub fn start_panel_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    scope: WorkspaceScope,
    gateway_id: Option<String>,
) -> Result<StartedTerminal, DesktopFailure> {
    let id = Uuid::new_v4().to_string();
    let log = |phase| {
        crate::diagnostics::log_client_event(&format!(
            "panel_terminal terminal={id} remote={} phase={phase}",
            gateway_id.is_some()
        ))
    };
    log("start");
    let result = (|| {
        let command = match gateway_id.as_deref() {
            Some(id) => ssh_command(&crate::runtime::remote_gateway::terminal_target(&app, id)?)?,
            None => CommandBuilder::new(default_shell()),
        };
        spawn_terminal(&state, scope, id.clone(), command)
    })();
    log(if result.is_ok() { "started" } else { "failed" });
    result
}

fn spawn_terminal(
    state: &TerminalState,
    scope: WorkspaceScope,
    id: String,
    mut command: CommandBuilder,
) -> Result<StartedTerminal, DesktopFailure> {
    let directory = scope.root()?;
    let pair = native_pty_system()
        .openpty(terminal_size(80, 24))
        .map_err(|_| DesktopFailure::operation_failed())?;
    command.cwd(&directory);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let (child, registration) = ProcessManager::current()
        .and_then(|manager| {
            manager.launch(
                "panel_terminal",
                false,
                || {
                    let mut child = pair
                        .slave
                        .spawn_command(command)
                        .map_err(std::io::Error::other)?;
                    let Some(pid) = child.process_id() else {
                        let _ = child.kill();
                        return Err(std::io::Error::other("终端没有 PID"));
                    };
                    Ok((child, pid))
                },
                |child| {
                    let _ = child.kill();
                },
            )
        })
        .map_err(|_| DesktopFailure::operation_failed())?;
    drop(pair.slave);
    let session = Arc::new(TerminalSession {
        scope,
        master: Mutex::new(pair.master),
        reader: Mutex::new(Some(reader)),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        process: registration,
    });
    state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .insert(id.clone(), session);
    Ok(StartedTerminal {
        id,
        cwd: directory.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn activate_panel_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    scope: WorkspaceScope,
    id: String,
) -> Result<(), DesktopFailure> {
    let session = get_session(&state, &scope, &id)?;
    let Some(mut reader) = session
        .reader
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .take()
    else {
        return Ok(());
    };
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit(
                        "panel-terminal-output",
                        TerminalOutput {
                            id: id.clone(),
                            scope: session.scope.clone(),
                            data: STANDARD.encode(&buffer[..n]),
                            closed: false,
                        },
                    );
                }
            }
        }
        let state = app.state::<TerminalState>();
        if let Ok(mut sessions) = state.0.lock() {
            sessions.remove(&id);
        }
        crate::diagnostics::log_client_event(&format!("panel_terminal terminal={id} phase=ended"));
        let _ = app.emit(
            "panel-terminal-output",
            TerminalOutput {
                id: id.clone(),
                scope: session.scope.clone(),
                data: String::new(),
                closed: true,
            },
        );
        tauri::async_runtime::spawn(async move {
            if session.process.terminate_tree().await.is_err() {
                crate::diagnostics::log_client_event(&format!(
                    "panel_terminal terminal={id} phase=cleanup_failed"
                ));
            }
        });
    });
    Ok(())
}

fn get_session(
    state: &State<'_, TerminalState>,
    scope: &WorkspaceScope,
    id: &str,
) -> Result<Arc<TerminalSession>, DesktopFailure> {
    let session = state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .get(id)
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)?;
    if &session.scope != scope {
        return Err(DesktopFailure::conflict());
    }
    Ok(session)
}

#[tauri::command]
pub fn write_panel_terminal(
    state: State<'_, TerminalState>,
    scope: WorkspaceScope,
    id: String,
    data: String,
) -> Result<(), DesktopFailure> {
    if data.len() > 16 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let session = get_session(&state, &scope, &id)?;
    let result = session
        .writer
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .write_all(data.as_bytes())
        .map_err(|_| DesktopFailure::operation_failed());
    result
}

#[tauri::command]
pub fn resize_panel_terminal(
    state: State<'_, TerminalState>,
    scope: WorkspaceScope,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), DesktopFailure> {
    let session = get_session(&state, &scope, &id)?;
    let result = session
        .master
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .resize(terminal_size(cols, rows))
        .map_err(|_| DesktopFailure::operation_failed());
    result
}

#[tauri::command]
pub async fn close_panel_terminal(
    state: State<'_, TerminalState>,
    scope: WorkspaceScope,
    id: String,
) -> Result<(), DesktopFailure> {
    let session = {
        let mut sessions = state
            .0
            .lock()
            .map_err(|_| DesktopFailure::operation_failed())?;
        if sessions
            .get(&id)
            .is_some_and(|session| session.scope != scope)
        {
            return Err(DesktopFailure::conflict());
        }
        sessions.remove(&id)
    };
    if let Some(session) = session {
        let closed = session.process.terminate_tree().await;
        let phase = if closed.is_ok() {
            "closed"
        } else {
            "cleanup_failed"
        };
        crate::diagnostics::log_client_event(&format!(
            "panel_terminal terminal={id} phase={phase}"
        ));
        closed.map_err(|_| DesktopFailure::operation_failed())?;
    }
    Ok(())
}

pub fn close_all_panel_terminals(state: State<'_, TerminalState>) {
    if let Ok(mut sessions) = state.0.lock() {
        for session in sessions.values() {
            if let Ok(mut child) = session.child.lock() {
                let _ = child.kill();
            }
        }
        sessions.clear();
    }
}

#[cfg(test)]
#[path = "tests/panel_terminal.rs"]
mod tests;
