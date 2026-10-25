use crate::errors::DesktopFailure;
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::OsString,
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

struct TerminalSession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    reader: Mutex<Option<Box<dyn Read + Send>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
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

#[tauri::command]
pub fn start_panel_terminal(
    state: State<'_, TerminalState>,
    cwd: Option<String>,
) -> Result<StartedTerminal, DesktopFailure> {
    let directory = match cwd {
        Some(path) if !path.trim().is_empty() => {
            let directory = Path::new(&path);
            if !directory.is_absolute() || !directory.is_dir() {
                return Err(DesktopFailure::invalid_input());
            }
            directory.to_path_buf()
        }
        _ => std::env::current_dir().map_err(|_| DesktopFailure::operation_failed())?,
    };
    let pair = native_pty_system()
        .openpty(terminal_size(80, 24))
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut command = CommandBuilder::new(default_shell());
    command.cwd(&directory);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|_| DesktopFailure::operation_failed())?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let id = Uuid::new_v4().to_string();
    let session = Arc::new(TerminalSession {
        master: Mutex::new(pair.master),
        reader: Mutex::new(Some(reader)),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
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
    id: String,
) -> Result<(), DesktopFailure> {
    let session = get_session(&state, &id)?;
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
                            data: STANDARD.encode(&buffer[..n]),
                            closed: false,
                        },
                    );
                }
            }
        }
        let _ = app.emit(
            "panel-terminal-output",
            TerminalOutput {
                id,
                data: String::new(),
                closed: true,
            },
        );
    });
    Ok(())
}

fn get_session(
    state: &State<'_, TerminalState>,
    id: &str,
) -> Result<Arc<TerminalSession>, DesktopFailure> {
    state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .get(id)
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)
}

#[tauri::command]
pub fn write_panel_terminal(
    state: State<'_, TerminalState>,
    id: String,
    data: String,
) -> Result<(), DesktopFailure> {
    if data.len() > 16 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let session = get_session(&state, &id)?;
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
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), DesktopFailure> {
    let session = get_session(&state, &id)?;
    let result = session
        .master
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .resize(terminal_size(cols, rows))
        .map_err(|_| DesktopFailure::operation_failed());
    result
}

#[tauri::command]
pub fn close_panel_terminal(
    state: State<'_, TerminalState>,
    id: String,
) -> Result<(), DesktopFailure> {
    state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .remove(&id);
    Ok(())
}

#[cfg(test)]
#[path = "tests/panel_terminal.rs"]
mod tests;
