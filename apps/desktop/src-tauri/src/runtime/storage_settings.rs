use super::location::{
    acquire_storage_lock, location_file, read_storage_location, write_location_json,
};
use super::BackendState;
use crate::{
    diagnostics::log_client_event,
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path, CanonicalizePlain},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSettings {
    current_path: String,
    pending_path: Option<String>,
    enabled: bool,
    blocked: bool,
    error: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum StorageAction {
    Get,
    Save { path: String },
    Cancel,
    Retry,
}

struct Selection {
    file: PathBuf,
    current: PathBuf,
    pending: Option<PathBuf>,
    enabled: bool,
    blocked: bool,
    error: Option<String>,
}

pub struct StorageSettingsState(Mutex<Selection>);

impl StorageSettingsState {
    pub(super) fn selected(&self) -> Result<PathBuf, String> {
        let selection = self.0.lock().map_err(|_| "无法读取存储状态")?;
        if selection.blocked {
            return Err("待生效存储位置不可用，请在存储设置中重试或取消更改".into());
        }
        Ok(selection.current.clone())
    }
}

impl Selection {
    fn load(file: PathBuf, default: PathBuf, enabled: bool) -> Result<Self, String> {
        let current = read_storage_location(&file)?.unwrap_or(default);
        let pending = if filesystem_path(&file).exists() {
            let value: serde_json::Value = serde_json::from_slice(
                &fs::read(filesystem_path(&file)).map_err(|_| "读取存储设置失败")?,
            )
            .map_err(|_| "存储设置损坏")?;
            match value.get("pending_path") {
                None | Some(serde_json::Value::Null) => None,
                Some(serde_json::Value::String(path)) => Some(plain_path(Path::new(path))),
                _ => return Err("待生效存储设置损坏".into()),
            }
        } else {
            None
        };
        Ok(Self {
            file,
            current,
            pending,
            enabled,
            blocked: false,
            error: None,
        })
    }

    fn snapshot(&self) -> StorageSettings {
        StorageSettings {
            current_path: self.current.to_string_lossy().into_owned(),
            pending_path: self
                .pending
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            enabled: self.enabled,
            blocked: self.blocked,
            error: self.error.clone(),
        }
    }

    fn persist(&self, current: &Path, pending: Option<&Path>) -> Result<(), String> {
        write_location_json(
            &self.file,
            &json!({
                "schema": 1, "storage_path": plain_path(current).to_string_lossy(),
                "pending_path": pending.map(|path| plain_path(path).to_string_lossy().into_owned()),
            }),
        )
        .map_err(|_| "save_failed".to_owned())
    }

    // Called only before storage-dependent startup, or while startup is blocked.
    fn apply(&mut self) -> Result<(), String> {
        let Some(pending) = &self.pending else {
            return Ok(());
        };
        let selected = validate(pending)?;
        let storage = selected.join("HermessAgentDesktop");
        fs::create_dir_all(filesystem_path(&storage.join("control"))).map_err(|_| "unavailable")?;
        let _lock = acquire_storage_lock(&storage).map_err(|_| "in_use")?;
        self.persist(&selected, None)?;
        self.current = selected;
        self.pending = None;
        self.blocked = false;
        self.error = None;
        Ok(())
    }

    fn request(&mut self, action: StorageAction, gateway_running: bool) -> Result<(), String> {
        if gateway_running
            && (matches!(action, StorageAction::Save { .. })
                || (matches!(action, StorageAction::Retry) && self.blocked))
        {
            return Err("gateway_running".into());
        }
        self.run(action)
    }

    fn run(&mut self, action: StorageAction) -> Result<(), String> {
        if matches!(action, StorageAction::Get) {
            return Ok(());
        }
        if !self.enabled {
            return Err("development".into());
        }
        match action {
            StorageAction::Save { path } => {
                let selected = validate(Path::new(&path))?;
                let current = self
                    .current
                    .canonicalize_plain()
                    .unwrap_or_else(|_| self.current.clone());
                if selected == current {
                    return Err("same_path".into());
                }
                // A product data directory cannot itself become another data root.
                if selected.starts_with(current.join("HermessAgentDesktop"))
                    || current.starts_with(selected.join("HermessAgentDesktop"))
                {
                    return Err("invalid_path".into());
                }
                let storage = selected.join("HermessAgentDesktop");
                if filesystem_path(&storage.join("control")).is_dir() {
                    let _lock = acquire_storage_lock(&storage).map_err(|_| "in_use")?;
                    self.persist(&self.current, Some(&selected))?;
                } else {
                    self.persist(&self.current, Some(&selected))?;
                }
                self.pending = Some(selected);
            }
            StorageAction::Cancel => {
                // A blocked startup has no runtime. Verify the old location before
                // letting storage-dependent features resume there.
                let _old_lock = if self.blocked {
                    let current = validate(&self.current)?;
                    let storage = current.join("HermessAgentDesktop");
                    if filesystem_path(&storage.join("control")).is_dir() {
                        Some(acquire_storage_lock(&storage).map_err(|_| "in_use")?)
                    } else {
                        None
                    }
                } else {
                    None
                };
                self.persist(&self.current, None)?;
                self.pending = None;
                self.blocked = false;
            }
            StorageAction::Retry if self.blocked => self.apply()?,
            StorageAction::Retry | StorageAction::Get => {}
        }
        self.error = None;
        Ok(())
    }
}

fn validate(selected: &Path) -> Result<PathBuf, String> {
    let selected = plain_path(selected);
    if !selected.is_absolute() {
        return Err("invalid_path".into());
    }
    let storage = selected.join("HermessAgentDesktop");
    for ancestor in storage.ancestors() {
        match fs::symlink_metadata(filesystem_path(ancestor)) {
            Ok(metadata) => {
                if !metadata.is_dir() || metadata.file_type().is_symlink() {
                    return Err("invalid_path".into());
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err("invalid_path".into());
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && ancestor == storage => {}
            Err(_) => return Err("unavailable".into()),
        }
    }
    let selected = selected.canonicalize_plain().map_err(|_| "unavailable")?;
    if filesystem_path(&storage).exists() {
        let nonempty = fs::read_dir(filesystem_path(&storage))
            .map_err(|_| "unavailable")?
            .next()
            .is_some();
        let mut recognized = false;
        // Diagnostics can create logs before the first successful Gateway start.
        for name in ["control", "hermes-home", "programming", "logs"] {
            let path = storage.join(name);
            match fs::symlink_metadata(filesystem_path(&path)) {
                Ok(metadata) => {
                    if !metadata.is_dir() || metadata.file_type().is_symlink() {
                        return Err("invalid_data".into());
                    }
                    #[cfg(windows)]
                    {
                        use std::os::windows::fs::MetadataExt;
                        if metadata.file_attributes() & 0x400 != 0 {
                            return Err("invalid_data".into());
                        }
                    }
                    recognized = true;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("unavailable".into()),
            }
        }
        if nonempty && !recognized {
            return Err("invalid_data".into());
        }
    }
    // Probe the actual product directory when it exists, and otherwise its parent.
    let probe_root = if filesystem_path(&storage).is_dir() {
        &storage
    } else {
        &selected
    };
    let probe = probe_root.join(format!(".hermess-storage-probe-{}", Uuid::new_v4()));
    let mut handle = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(filesystem_path(&probe))
        .map_err(|_| "unavailable")?;
    let writable = handle
        .write_all(b"storage-check")
        .and_then(|_| handle.sync_all());
    drop(handle);
    let removed = fs::remove_file(filesystem_path(&probe));
    writable.and(removed).map_err(|_| "unavailable")?;
    Ok(selected)
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let enabled = !cfg!(debug_assertions);
    let default = if enabled {
        plain_path(
            &app.path()
                .app_local_data_dir()
                .map_err(|_| "无法定位默认存储位置")?,
        )
    } else {
        PathBuf::from(
            super::dev_backend_defaults()
                .map_err(|_| "无法定位开发存储位置")?
                .storage_path,
        )
    };
    let mut selection = if enabled {
        Selection::load(location_file(app)?, default, true)?
    } else {
        Selection {
            file: location_file(app)?,
            current: default,
            pending: None,
            enabled: false,
            blocked: false,
            error: None,
        }
    };
    if enabled && selection.pending.is_some() {
        let operation = Uuid::new_v4();
        log_client_event(&format!(
            "storage_change_apply_started operation={operation}"
        ));
        if let Err(error) = selection.apply() {
            log_client_event(&format!(
                "ERROR storage_change_apply_failed operation={operation} reason={error}"
            ));
            selection.blocked = true;
            selection.error = Some(error);
        } else {
            log_client_event(&format!(
                "storage_change_apply_completed operation={operation}"
            ));
        }
    }
    app.manage(StorageSettingsState(Mutex::new(selection)));
    Ok(())
}

#[tauri::command]
pub async fn storage_location_request(
    app: AppHandle,
    window: WebviewWindow,
    backend: State<'_, BackendState>,
    request: StorageAction,
) -> Result<StorageSettings, DesktopFailure> {
    if window.label() != "main" {
        return Err(DesktopFailure::invalid_input());
    }
    // Serialize changes with Gateway start/stop, then check native ownership.
    let _lifecycle = if matches!(request, StorageAction::Get) {
        None
    } else {
        Some(backend.6.gate.lock().await)
    };
    let gateway_running = backend.0.lock().await.is_some();
    let state = app.state::<StorageSettingsState>();
    let mut selection = state
        .0
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let operation = match &request {
        StorageAction::Get => "get",
        StorageAction::Save { .. } => "save",
        StorageAction::Cancel => "cancel",
        StorageAction::Retry => "retry",
    };
    let id = Uuid::new_v4();
    if operation != "get" {
        log_client_event(&format!(
            "storage_change_{operation}_started operation={id}"
        ));
    }
    match selection.request(request, gateway_running) {
        Ok(()) if operation != "get" => log_client_event(&format!(
            "storage_change_{operation}_completed operation={id}"
        )),
        Err(error) => {
            log_client_event(&format!(
                "ERROR storage_change_{operation}_failed operation={id} reason={error}"
            ));
            selection.error = Some(error);
        }
        _ => {}
    }
    Ok(selection.snapshot())
}

#[cfg(test)]
#[path = "tests/storage_settings.rs"]
mod tests;
