use crate::{errors::DesktopFailure, runtime::BackendState};
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, Window, WindowEvent};
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWindowTarget {
    profile: String,
    session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWindowContext {
    target: ChatWindowTarget,
    backend: Option<crate::runtime::BackendInfo>,
    storage_path: String,
}

#[derive(Default)]
pub struct ChatWindowState(Mutex<HashMap<String, ChatWindowTarget>>);

fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
}

fn can_open(source: &str, session_id: &str) -> bool {
    source == "main" && valid_session_id(session_id)
}

fn target_for_label(
    entries: &HashMap<String, ChatWindowTarget>,
    label: &str,
) -> Option<ChatWindowTarget> {
    entries.get(label).cloned()
}

#[tauri::command]
pub async fn open_chat_window(
    app: AppHandle,
    window: WebviewWindow,
    backend: State<'_, BackendState>,
    windows: State<'_, ChatWindowState>,
    profile: String,
    session_id: String,
) -> Result<String, DesktopFailure> {
    let label = format!("chat-{}", Uuid::new_v4());
    crate::diagnostics::log_client_event(&format!("chat_window_open_started label={label}"));
    if !can_open(window.label(), &session_id) {
        crate::diagnostics::log_client_event(&format!(
            "ERROR chat_window_open_rejected label={label} reason=source_or_target"
        ));
        return Err(DesktopFailure::invalid_input());
    }
    if let Err(failure) = backend.validate_chat_window_profile(&profile).await {
        crate::diagnostics::log_client_event(&format!(
            "ERROR chat_window_open_rejected label={label} reason=profile_or_runtime"
        ));
        return Err(failure);
    }
    windows
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .insert(
            label.clone(),
            ChatWindowTarget {
                profile,
                session_id,
            },
        );
    let result =
        tauri::WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("chat-window.html".into()))
            .title("Hermess Chat")
            .inner_size(900.0, 720.0)
            .min_inner_size(650.0, 500.0)
            .center()
            .build();
    if result.is_err() {
        let _ = windows.0.lock().map(|mut entries| entries.remove(&label));
        crate::diagnostics::log_client_event(&format!(
            "ERROR chat_window_open_failed label={label}"
        ));
        return Err(DesktopFailure::operation_failed());
    }
    crate::diagnostics::log_client_event(&format!("chat_window_open_completed label={label}"));
    Ok(label)
}

#[tauri::command]
pub async fn get_chat_window_context(
    window: WebviewWindow,
    backend: State<'_, BackendState>,
    windows: State<'_, ChatWindowState>,
) -> Result<ChatWindowContext, DesktopFailure> {
    let target = {
        let entries = windows
            .0
            .lock()
            .map_err(|_| DesktopFailure::operation_failed())?;
        target_for_label(&entries, window.label()).ok_or_else(DesktopFailure::invalid_input)?
    };
    let snapshot = backend.chat_window_snapshot().await?;
    Ok(ChatWindowContext {
        target,
        backend: snapshot.as_ref().map(|(info, _)| info.clone()),
        storage_path: snapshot.map(|(_, path)| path).unwrap_or_default(),
    })
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if !matches!(event, WindowEvent::Destroyed) || !window.label().starts_with("chat-") {
        return;
    }
    let state = window.app_handle().state::<ChatWindowState>();
    if state
        .0
        .lock()
        .is_ok_and(|mut entries| entries.remove(window.label()).is_some())
    {
        crate::diagnostics::log_client_event(&format!(
            "chat_window_closed label={}",
            window.label()
        ));
    }
}

#[cfg(test)]
#[path = "tests/chat_windows.rs"]
mod tests;
