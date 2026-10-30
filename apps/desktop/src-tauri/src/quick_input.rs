use crate::errors::DesktopFailure;
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    profile: String,
    session_id: String,
    epoch: String,
    busy: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Submission {
    request_id: String,
    target: Target,
    text: String,
}
#[derive(Default)]
struct Inner {
    target: Option<Target>,
    pending: Option<(Submission, bool)>,
    recent: VecDeque<String>,
}
#[derive(Default)]
pub struct QuickState(Mutex<Inner>);

impl Inner {
    fn enqueue(
        &mut self,
        request_id: String,
        target: Target,
        text: String,
    ) -> Result<Submission, DesktopFailure> {
        if text.trim().is_empty() || text.len() > 64 * 1024 || target.busy {
            return Err(DesktopFailure::invalid_input());
        }
        if uuid::Uuid::parse_str(&request_id).is_err() {
            return Err(DesktopFailure::invalid_input());
        }
        if self.target.as_ref() != Some(&target)
            || self.pending.is_some()
            || self.recent.contains(&request_id)
        {
            return Err(DesktopFailure::conflict());
        }
        let submission = Submission {
            request_id: request_id.clone(),
            target,
            text,
        };
        self.pending = Some((submission.clone(), false));
        self.recent.push_back(request_id);
        if self.recent.len() > 128 {
            self.recent.pop_front();
        }
        Ok(submission)
    }

    fn claim(&mut self, request_id: &str) -> Result<Submission, DesktopFailure> {
        let (submission, taken) = self.pending.as_mut().ok_or_else(DesktopFailure::conflict)?;
        if submission.request_id != request_id || *taken {
            return Err(DesktopFailure::conflict());
        }
        *taken = true;
        Ok(submission.clone())
    }
}

fn only(window: &WebviewWindow, label: &str) -> Result<(), DesktopFailure> {
    if window.label() == label {
        Ok(())
    } else {
        Err(DesktopFailure::invalid_input())
    }
}

pub fn show(app: &AppHandle) {
    if !crate::device::quick_enabled(app) {
        return;
    }
    if let Some(window) = app.get_webview_window("quick-input") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else {
        let _ = tauri::WebviewWindowBuilder::new(
            app,
            "quick-input",
            WebviewUrl::App("quick-input.html".into()),
        )
        .title("Hermess 快捷输入")
        .inner_size(640.0, 230.0)
        .min_inner_size(400.0, 230.0)
        .resizable(true)
        .always_on_top(true)
        .center()
        .build();
    }
}

#[tauri::command]
pub fn set_quick_target(
    window: WebviewWindow,
    state: State<'_, QuickState>,
    target: Option<Target>,
) -> Result<(), DesktopFailure> {
    only(&window, "main")?;
    state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .target = target;
    Ok(())
}

#[tauri::command]
pub fn get_quick_target(state: State<'_, QuickState>) -> Result<Option<Target>, DesktopFailure> {
    Ok(state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .target
        .clone())
}

#[tauri::command]
pub fn submit_quick_input(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, QuickState>,
    request_id: String,
    target: Target,
    text: String,
) -> Result<(), DesktopFailure> {
    only(&window, "quick-input")?;
    let mut inner = state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let submission = inner.enqueue(request_id, target, text)?;
    if app
        .emit_to("main", "quick-input-submit", submission)
        .is_err()
    {
        inner.pending = None;
        return Err(DesktopFailure::operation_failed());
    }
    Ok(())
}

#[tauri::command]
pub fn take_quick_submission(
    window: WebviewWindow,
    state: State<'_, QuickState>,
    request_id: String,
) -> Result<Submission, DesktopFailure> {
    only(&window, "main")?;
    let mut inner = state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?;
    inner.claim(&request_id)
}

#[cfg(test)]
#[path = "tests/quick_input.rs"]
mod tests;

#[tauri::command]
pub fn finish_quick_submission(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, QuickState>,
    request_id: String,
    error: Option<String>,
) -> Result<(), DesktopFailure> {
    only(&window, "main")?;
    let mut inner = state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !inner
        .pending
        .as_ref()
        .is_some_and(|(submission, taken)| submission.request_id == request_id && *taken)
    {
        return Err(DesktopFailure::conflict());
    }
    app.emit_to(
        "quick-input",
        "quick-input-result",
        serde_json::json!({"requestId":request_id,"error":error}),
    )
    .map_err(|_| DesktopFailure::operation_failed())?;
    inner.pending = None;
    if error.is_none() {
        if let Some(window) = app.get_webview_window("quick-input") {
            let _ = window.hide();
        }
    }
    Ok(())
}
