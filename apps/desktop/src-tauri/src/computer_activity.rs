//! Native owner of the banner. Tool gaps retain ownership until the turn really settles.
mod window;

use crate::{errors::DesktopFailure, gateway::computer_activity::GatewayStop};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tokio::sync::{mpsc, Notify};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Key {
    pub connection: String,
    pub session: String,
    pub generation: u64,
}

#[derive(Clone)]
pub(crate) enum Stop {
    Gateway(GatewayStop),
    Codex(mpsc::Sender<Value>),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Idle,
    Active,
    Stopping,
    Unknown,
}

struct Operation {
    stop: Stop,
    phase: Phase,
    tools: HashSet<String>,
    terminal: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    phase: Phase,
    revision: u64,
    shortcut: Option<&'static str>,
    shortcut_unavailable: bool,
}

#[derive(Default)]
struct Inner {
    operations: BTreeMap<Key, Operation>,
    revision: u64,
    shortcut_registered: bool,
    takeover: bool,
}

impl Inner {
    fn fingerprint(&self) -> Vec<(Key, Phase, usize, bool)> {
        self.operations
            .iter()
            .map(|(key, op)| (key.clone(), op.phase, op.tools.len(), op.terminal))
            .collect()
    }
    fn status(&self) -> Status {
        let phase = if self
            .operations
            .values()
            .any(|op| op.phase == Phase::Unknown)
        {
            Phase::Unknown
        } else if self
            .operations
            .values()
            .any(|op| op.phase == Phase::Stopping)
        {
            Phase::Stopping
        } else if self.operations.is_empty() {
            Phase::Idle
        } else {
            Phase::Active
        };
        Status {
            phase,
            revision: self.revision,
            shortcut: self.shortcut_registered.then_some(window::SHORTCUT),
            shortcut_unavailable: !self.shortcut_registered,
        }
    }

    fn start(&mut self, key: Key, tool: &str, stop: Stop) -> bool {
        let new = !self.operations.contains_key(&key);
        let op = self.operations.entry(key).or_insert_with(|| Operation {
            stop: stop.clone(),
            phase: Phase::Active,
            tools: HashSet::new(),
            terminal: false,
        });
        op.stop = stop;
        op.tools.insert(tool.to_owned());
        new
    }

    fn settle(&mut self, key: &Key, tool: Option<&str>, terminal: bool) {
        if let Some(op) = self.operations.get_mut(key) {
            if let Some(tool) = tool {
                op.tools.remove(tool);
            }
            op.terminal |= terminal;
            if op.terminal && op.tools.is_empty() {
                self.operations.remove(key);
            }
        }
    }
}

#[derive(Default)]
pub struct ComputerActivityState {
    inner: Mutex<Inner>,
    changed: Notify,
}

fn mutate(app: &AppHandle, update: impl FnOnce(&mut Inner)) {
    let Some(state) = app.try_state::<ComputerActivityState>() else {
        return;
    };
    let Ok(mut inner) = state.inner.lock() else {
        return;
    };
    let before = inner.fingerprint();
    let shortcut_before = inner.shortcut_registered;
    update(&mut inner);
    if inner.operations.is_empty() {
        inner.takeover = false;
    }
    let after = inner.fingerprint();
    if before == after && shortcut_before == inner.shortcut_registered {
        return;
    }
    inner.revision += 1;
    drop(inner);
    state.changed.notify_waiters();
    // Window calls run on the UI thread, read the latest state, and cannot reopen a stale banner.
    window::refresh(app);
}

pub(crate) fn start(app: &AppHandle, key: Key, tool: &str, stop: Stop) {
    let mut takeover = false;
    mutate(app, |inner| {
        takeover = inner.takeover;
        if inner.start(key.clone(), tool, stop) {
            crate::diagnostics::log_client_event(&format!(
                "computer_activity_start operation={} generation={}",
                key.connection, key.generation
            ));
        }
    });
    if takeover {
        stop_all(app);
    }
}

pub(crate) fn tool_finished(app: &AppHandle, key: &Key, tool: &str) {
    mutate(app, |inner| {
        let existed = inner.operations.contains_key(key);
        inner.settle(key, Some(tool), false);
        if existed && !inner.operations.contains_key(key) {
            crate::diagnostics::log_client_event(&format!(
                "computer_activity_result operation={} generation={} settled=true",
                key.connection, key.generation
            ));
        }
    });
}

pub(crate) fn terminal(app: &AppHandle, key: &Key) {
    mutate(app, |inner| {
        let existed = inner.operations.contains_key(key);
        inner.settle(key, None, true);
        if existed {
            crate::diagnostics::log_client_event(&format!(
                "computer_activity_turn_terminal operation={} pending={}",
                key.connection,
                inner.operations.contains_key(key)
            ));
        }
    });
}

/// Only a confirmed product-owned process-tree cleanup may bypass missing tool completions.
pub(crate) fn process_finished(app: &AppHandle, connection: &str, clean: bool) {
    let mut affected = 0;
    mutate(app, |inner| {
        affected = inner
            .operations
            .keys()
            .filter(|key| key.connection == connection)
            .count();
        if clean {
            inner
                .operations
                .retain(|key, _| key.connection != connection);
        } else {
            for (key, op) in &mut inner.operations {
                if key.connection == connection {
                    op.phase = Phase::Unknown;
                }
            }
        }
    });
    if affected > 0 {
        crate::diagnostics::log_client_event(&format!(
            "{}computer_activity_cleanup operation={connection} clean={clean} targets={affected}",
            if clean { "" } else { "ERROR " }
        ));
    }
}

pub(crate) fn disconnected(app: &AppHandle, connection: &str) {
    mutate(app, |inner| {
        let mut affected = 0;
        for (key, op) in &mut inner.operations {
            if key.connection == connection {
                if op.phase != Phase::Unknown {
                    affected += 1;
                }
                op.phase = Phase::Unknown;
            }
        }
        if affected > 0 {
            crate::diagnostics::log_client_event(&format!(
                "ERROR computer_activity_connection_lost operation={connection} targets={affected}"
            ));
        }
    });
}

pub(crate) fn session_unknown(app: &AppHandle, connection: &str, session: &str) {
    mutate(app, |inner| {
        let mut affected = 0;
        for (key, op) in &mut inner.operations {
            if key.connection == connection && key.session == session {
                if op.phase != Phase::Unknown {
                    affected += 1;
                }
                op.phase = Phase::Unknown;
            }
        }
        if affected > 0 {
            crate::diagnostics::log_client_event(&format!(
                "ERROR computer_activity_state_unknown operation={connection} targets={affected}"
            ));
        }
    });
}

pub(crate) fn reconnected(
    app: &AppHandle,
    old: &str,
    new: &str,
    mut rebind: impl FnMut(&mut Stop),
) {
    let mut resend_stop = false;
    mutate(app, |inner| {
        let keys: Vec<_> = inner
            .operations
            .keys()
            .filter(|key| key.connection == old)
            .cloned()
            .collect();
        if !keys.is_empty() {
            crate::diagnostics::log_client_event(&format!(
                "computer_activity_reconnected previous={old} operation={new} targets={}",
                keys.len()
            ));
        }
        for key in keys {
            if let Some(mut op) = inner.operations.remove(&key) {
                if op.phase == Phase::Stopping {
                    op.phase = Phase::Unknown;
                    resend_stop = true;
                }
                rebind(&mut op.stop);
                inner.operations.insert(
                    Key {
                        connection: new.to_owned(),
                        ..key
                    },
                    op,
                );
            }
        }
    });
    if resend_stop {
        stop_all(app);
    }
}

pub fn setup(app: &AppHandle) {
    let registered = window::register_shortcut(app);
    mutate(app, |inner| inner.shortcut_registered = registered);
}

pub fn handle_shortcut(app: &AppHandle, shortcut: &tauri_plugin_global_shortcut::Shortcut) -> bool {
    window::handle_shortcut(app, shortcut)
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == window::LABEL {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    }
}

fn authorize(window: &WebviewWindow) -> Result<(), DesktopFailure> {
    if window.label() == window::LABEL {
        Ok(())
    } else {
        Err(DesktopFailure::invalid_input())
    }
}

#[tauri::command]
pub fn get_computer_activity(
    window: WebviewWindow,
    state: State<'_, ComputerActivityState>,
) -> Result<Status, DesktopFailure> {
    authorize(&window)?;
    Ok(state
        .inner
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .status())
}

#[tauri::command]
pub fn stop_computer_activity(app: AppHandle, window: WebviewWindow) -> Result<(), DesktopFailure> {
    authorize(&window)?;
    stop_all(&app);
    Ok(())
}

pub(crate) fn stop_all(app: &AppHandle) {
    let mut targets = Vec::new();
    mutate(app, |inner| {
        inner.takeover = !inner.operations.is_empty();
        for (key, op) in &mut inner.operations {
            if op.phase != Phase::Stopping {
                op.phase = Phase::Stopping;
                targets.push((key.clone(), op.stop.clone()));
            }
        }
    });
    for (key, stop) in targets {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::diagnostics::log_client_event(&format!(
                "computer_activity_stop_start operation={}",
                key.connection
            ));
            let accepted = match stop {
                Stop::Gateway(control) => control.interrupt().await.is_ok(),
                Stop::Codex(sender) => sender.send(json!({"kind":"stop"})).await.is_ok(),
            };
            let state = app.state::<ComputerActivityState>();
            let settled = tokio::time::timeout(Duration::from_secs(12), async {
                loop {
                    let notification = state.changed.notified();
                    tokio::pin!(notification);
                    notification.as_mut().enable();
                    if !state.inner.lock().unwrap().operations.contains_key(&key) {
                        break;
                    }
                    if !accepted {
                        return false;
                    }
                    notification.await;
                }
                true
            })
            .await
                == Ok(true);
            if !settled {
                mutate(&app, |inner| {
                    if let Some(op) = inner.operations.get_mut(&key) {
                        op.phase = Phase::Unknown;
                    }
                });
            }
            crate::diagnostics::log_client_event(&format!(
                "{}computer_activity_stop_result operation={} confirmed={settled}",
                if settled { "" } else { "ERROR " },
                key.connection
            ));
        });
    }
}

#[cfg(test)]
#[path = "tests/computer_activity.rs"]
mod tests;

#[cfg(all(test, windows))]
#[path = "tests/computer_activity_native.rs"]
mod native_tests;
