use crate::errors::DesktopFailure;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, str::FromStr, sync::Mutex};
use tauri::{App, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuickEntrySettings {
    enabled: bool,
    shortcut: String,
}

impl Default for QuickEntrySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            shortcut: DEFAULT_SHORTCUT.into(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickEntryRegistration {
    enabled: bool,
    shortcut: String,
    registered: bool,
    error: Option<&'static str>,
}

pub struct QuickEntryState(Mutex<QuickEntryRegistration>);

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("quick-entry.json"))
        .map_err(|error| error.to_string())
}

fn valid_shortcut(raw: &str) -> Result<Shortcut, &'static str> {
    if raw.len() > 100 || raw.trim().is_empty() {
        return Err("invalid");
    }
    let shortcut = Shortcut::from_str(raw).map_err(|_| "invalid")?;
    if shortcut.mods.is_empty() || shortcut.key == Code::Escape {
        return Err("invalid");
    }
    Ok(shortcut)
}

fn read_settings(app: &AppHandle) -> QuickEntrySettings {
    let loaded = settings_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .filter(|bytes| bytes.len() <= 4096)
        .and_then(|bytes| serde_json::from_slice::<QuickEntrySettings>(&bytes).ok());
    match loaded {
        Some(value) if valid_shortcut(&value.shortcut).is_ok() => value,
        _ => QuickEntrySettings::default(),
    }
}

fn persist(app: &AppHandle, settings: &QuickEntrySettings) -> Result<(), String> {
    let path = settings_path(app)?;
    fs::create_dir_all(path.parent().ok_or("配置目录无效")?).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(settings).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick-entry") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        "quick-entry",
        WebviewUrl::App("quick-entry.html".into()),
    )
    .title("Hermess 快捷输入")
    .inner_size(640.0, 168.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .center()
    .build();
}

fn register(app: &AppHandle, shortcut: &str) -> bool {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || toggle_window(&handle));
            }
        })
        .is_ok()
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let settings = read_settings(app.handle());
    let registered = settings.enabled && register(app.handle(), &settings.shortcut);
    app.manage(QuickEntryState(Mutex::new(QuickEntryRegistration {
        enabled: settings.enabled,
        shortcut: settings.shortcut,
        registered,
        error: if settings.enabled && !registered {
            Some("taken")
        } else {
            None
        },
    })));
    Ok(())
}

#[tauri::command]
pub fn get_quick_entry_registration(
    state: tauri::State<'_, QuickEntryState>,
) -> QuickEntryRegistration {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_quick_entry_settings(
    app: AppHandle,
    state: tauri::State<'_, QuickEntryState>,
    enabled: bool,
    shortcut: String,
) -> Result<QuickEntryRegistration, DesktopFailure> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let previous = current.clone();
    if valid_shortcut(&shortcut).is_err() {
        return Ok(QuickEntryRegistration {
            error: Some("invalid"),
            ..previous
        });
    }
    let same_shortcut = previous.shortcut == shortcut;
    if enabled && (!same_shortcut || !previous.registered) && !register(&app, &shortcut) {
        return Ok(QuickEntryRegistration {
            error: Some("taken"),
            ..previous
        });
    }
    let next = QuickEntryRegistration {
        enabled,
        shortcut: shortcut.clone(),
        registered: enabled,
        error: None,
    };
    if persist(
        &app,
        &QuickEntrySettings {
            enabled,
            shortcut: shortcut.clone(),
        },
    )
    .is_err()
    {
        if enabled && (!same_shortcut || !previous.registered) {
            let _ = app.global_shortcut().unregister(shortcut.as_str());
        }
        return Err(DesktopFailure::operation_failed());
    }
    if previous.registered && (!enabled || !same_shortcut) {
        let _ = app.global_shortcut().unregister(previous.shortcut.as_str());
    }
    *current = next.clone();
    if !enabled {
        if let Some(window) = app.get_webview_window("quick-entry") {
            let _ = window.hide();
        }
    }
    Ok(next)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuickEntrySubmission {
    id: String,
    text: String,
}

#[tauri::command]
pub fn submit_quick_entry(
    app: AppHandle,
    source: WebviewWindow,
    id: String,
    text: String,
) -> Result<(), DesktopFailure> {
    if source.label() != "quick-entry"
        || id.len() > 100
        || id.is_empty()
        || text.trim().is_empty()
        || text.len() > 20_000
    {
        return Err(DesktopFailure::invalid_input());
    }
    app.emit_to(
        "main",
        "quick-entry-submit",
        QuickEntrySubmission { id, text },
    )
    .map_err(|_| DesktopFailure::operation_failed())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuickEntryResult {
    id: String,
    ok: bool,
    message: String,
}

#[tauri::command]
pub fn acknowledge_quick_entry(
    app: AppHandle,
    source: WebviewWindow,
    id: String,
    ok: bool,
    message: String,
) -> Result<(), DesktopFailure> {
    if source.label() != "main" || id.len() > 100 || id.is_empty() {
        return Err(DesktopFailure::invalid_input());
    }
    app.emit_to(
        "quick-entry",
        "quick-entry-result",
        QuickEntryResult { id, ok, message },
    )
    .map_err(|_| DesktopFailure::operation_failed())
}

#[cfg(test)]
#[path = "tests/quick_entry.rs"]
mod tests;
