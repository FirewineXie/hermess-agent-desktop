use crate::{device_power::WakeGuard, errors::DesktopFailure};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub keep_awake: bool,
    pub f12_devtools: bool,
    pub quick_enabled: bool,
    pub shortcut: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            keep_awake: false,
            f12_devtools: false,
            quick_enabled: false,
            shortcut: "CommandOrControl+Shift+Space".into(),
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    preferences: Preferences,
    registered: bool,
    awake: bool,
    f12_supported: bool,
    error: Option<String>,
}
#[derive(Default)]
struct Inner {
    preferences: Preferences,
    registered: bool,
    awake: Option<WakeGuard>,
    error: Option<String>,
    wake_error: Option<String>,
    shutting_down: bool,
}
#[derive(Default)]
pub struct DeviceState(Mutex<Inner>);

fn path(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| DesktopFailure::operation_failed())?
        .join("desktop-preferences.json"))
}
fn status(inner: &Inner) -> Status {
    Status {
        preferences: inner.preferences.clone(),
        registered: inner.registered,
        awake: inner.awake.is_some(),
        f12_supported: cfg!(windows),
        error: inner.error.clone().or_else(|| inner.wake_error.clone()),
    }
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let loaded = std::fs::read(path(app).map_err(|_| std::io::Error::other("设备配置目录不可用"))?);
    let (preferences, load_error) = match loaded {
        Ok(bytes) => match serde_json::from_slice::<Preferences>(&bytes) {
            Ok(value) => (value, None),
            Err(_) => (
                Preferences::default(),
                Some("设备配置损坏，请重新保存设备偏好".to_owned()),
            ),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            (Preferences::default(), None)
        }
        Err(_) => (Preferences::default(), Some("无法读取设备配置".to_owned())),
    };
    {
        let state = app.state::<DeviceState>();
        let mut inner = state
            .0
            .lock()
            .map_err(|_| std::io::Error::other("设备状态不可用"))?;
        inner.preferences = preferences.clone();
        inner.error = load_error;
        match validate_preferences(&preferences) {
            Ok(shortcut) if preferences.quick_enabled => {
                match app.global_shortcut().register(shortcut) {
                    Ok(()) => inner.registered = true,
                    Err(_) => inner.error = Some("快捷键注册失败，可能已被其他应用占用".into()),
                }
            }
            Err(_) => inner.error = Some("设备偏好无效，请重新保存".into()),
            _ => {}
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(window) = app.get_webview_window("main") {
            let _ =
                crate::diagnostics::apply_frontend_debug(window, preferences.f12_devtools).await;
        }
        loop {
            let running = app
                .state::<crate::runtime::BackendState>()
                .owned_process_running()
                .await;
            {
                let state = app.state::<DeviceState>();
                let Ok(mut inner) = state.0.lock() else {
                    return;
                };
                if inner.shutting_down {
                    return;
                }
                if !inner.preferences.keep_awake || !running {
                    inner.awake = None;
                    inner.wake_error = None;
                } else if inner.awake.is_none() {
                    match WakeGuard::acquire() {
                        Ok(guard) => {
                            inner.awake = Some(guard);
                            inner.wake_error = None;
                        }
                        Err(error) => inner.wake_error = Some(error),
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn get_device_status(state: State<'_, DeviceState>) -> Result<Status, DesktopFailure> {
    let inner = state.0.try_lock().map_err(|_| DesktopFailure::conflict())?;
    Ok(status(&inner))
}

fn persist_preferences(
    app: AppHandle,
    state: State<'_, DeviceState>,
    preferences: Preferences,
) -> Result<Status, DesktopFailure> {
    let shortcut = validate_preferences(&preferences)?;
    let mut inner = state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?;
    if inner.shutting_down {
        return Err(DesktopFailure::conflict());
    }
    let previous = inner.preferences.shortcut.parse::<Shortcut>().ok();
    let new_registration =
        preferences.quick_enabled && (!inner.registered || Some(shortcut) != previous);
    if new_registration {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|_| DesktopFailure::conflict())?;
    }
    let remove_previous =
        inner.registered && (!preferences.quick_enabled || previous != Some(shortcut));
    if remove_previous {
        if let Some(previous) = previous {
            if app.global_shortcut().unregister(previous).is_err() {
                if new_registration {
                    let _ = app.global_shortcut().unregister(shortcut);
                }
                return Err(DesktopFailure::operation_failed());
            }
        }
    }
    let persist = (|| {
        let path = path(&app)?;
        std::fs::create_dir_all(path.parent().unwrap())
            .map_err(|_| DesktopFailure::operation_failed())?;
        let temporary = path.with_extension("tmp");
        std::fs::write(
            &temporary,
            serde_json::to_vec_pretty(&preferences)
                .map_err(|_| DesktopFailure::operation_failed())?,
        )
        .map_err(|_| DesktopFailure::operation_failed())?;
        std::fs::rename(&temporary, &path).map_err(|_| DesktopFailure::operation_failed())
    })();
    if let Err(error) = persist {
        if new_registration {
            let _ = app.global_shortcut().unregister(shortcut);
        }
        if remove_previous {
            inner.registered =
                previous.is_some_and(|previous| app.global_shortcut().register(previous).is_ok());
            if !inner.registered {
                inner.error = Some("保存失败且旧快捷键恢复失败，请重新注册".into());
            }
        }
        return Err(error);
    }
    inner.registered = preferences.quick_enabled;
    if !preferences.keep_awake {
        inner.awake = None;
        inner.wake_error = None;
    }
    inner.preferences = preferences;
    inner.error = None;
    Ok(status(&inner))
}

pub fn shutdown(app: &AppHandle) {
    let state = app.state::<DeviceState>();
    if let Ok(mut inner) = state.0.lock() {
        inner.shutting_down = true;
        inner.awake = None;
        inner.registered = false;
    }
    let _ = app.global_shortcut().unregister_all();
    if let Some(window) = app.get_webview_window("quick-input") {
        let _ = window.destroy();
    }
}

#[tauri::command]
pub async fn save_device_preferences(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, DeviceState>,
    preferences: Preferences,
) -> Result<Status, DesktopFailure> {
    if window.label() != "main" {
        return Err(DesktopFailure::invalid_input());
    }
    let previous = state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?
        .preferences
        .clone();
    if cfg!(windows) && previous.f12_devtools != preferences.f12_devtools {
        crate::diagnostics::apply_frontend_debug(window.clone(), preferences.f12_devtools).await?;
    }
    match persist_preferences(app, state, preferences) {
        Ok(status) => Ok(status),
        Err(error) => {
            if cfg!(windows) {
                let _ =
                    crate::diagnostics::apply_frontend_debug(window, previous.f12_devtools).await;
            }
            Err(error)
        }
    }
}

pub fn quick_enabled(app: &AppHandle) -> bool {
    app.state::<DeviceState>()
        .0
        .try_lock()
        .is_ok_and(|inner| inner.registered && !inner.shutting_down)
}

fn validate_preferences(preferences: &Preferences) -> Result<Shortcut, DesktopFailure> {
    if preferences.shortcut.len() > 128 || preferences.f12_devtools && !cfg!(windows) {
        return Err(DesktopFailure::invalid_input());
    }
    let shortcut: Shortcut = preferences
        .shortcut
        .parse()
        .map_err(|_| DesktopFailure::invalid_input())?;
    if shortcut.mods.is_empty() {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(shortcut)
}

#[cfg(test)]
#[path = "tests/device.rs"]
mod tests;
