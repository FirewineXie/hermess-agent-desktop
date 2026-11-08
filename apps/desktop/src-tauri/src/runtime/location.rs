use crate::paths::{filesystem_path, plain_path};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

// Windowless native tests supply an isolated selection without changing process
// environment variables shared by parallel tests.
#[cfg(test)]
pub(super) struct TestStorageSelection(pub PathBuf);

pub(super) fn selected_storage(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(selected) = app.try_state::<TestStorageSelection>() {
        return Ok(plain_path(&selected.0));
    }
    if cfg!(debug_assertions) {
        return super::dev_backend_defaults()
            .map(|defaults| PathBuf::from(defaults.storage_path))
            .map_err(|_| "无法定位开发数据目录".into());
    }
    if let Some(state) = app.try_state::<super::storage_settings::StorageSettingsState>() {
        return state.selected();
    }
    release_storage(app)
}

fn release_storage(app: &AppHandle) -> Result<PathBuf, String> {
    match saved_storage_path(app)? {
        Some(path) => Ok(path),
        None => app
            .path()
            .app_local_data_dir()
            .map(|path| plain_path(&path))
            .map_err(|_| "无法定位默认数据目录".into()),
    }
}

pub(super) fn programming_root(app: &AppHandle) -> Result<PathBuf, String> {
    programming_root_at(&selected_storage(app)?)
}

fn programming_root_at(selected: &Path) -> Result<PathBuf, String> {
    let selected = plain_path(selected);
    if !selected.is_absolute() {
        return Err("存储位置必须是绝对路径".into());
    }
    let root = selected.join("HermessAgentDesktop").join("programming");
    // Resolve before Gateway startup, without requiring an existing Hermes home.
    // Refuse links/junctions before callers create files below the product root.
    for ancestor in root.ancestors() {
        match fs::symlink_metadata(filesystem_path(ancestor)) {
            Ok(metadata) => {
                if !metadata.is_dir() || metadata.file_type().is_symlink() {
                    return Err("产品存储位置不是普通目录".into());
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err("产品存储位置不能经过目录联接".into());
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("无法检查产品存储位置".into()),
        }
    }
    Ok(root)
}

pub(super) fn acquire_storage_lock(storage: &std::path::Path) -> Result<fs::File, String> {
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(filesystem_path(&storage.join("control").join("owner.lock")))
        .map_err(|_| "无法打开产品存储锁".to_string())?;
    lock.try_lock()
        .map_err(|_| "同一存储位置已有本产品实例，不能同时写入".to_string())?;
    Ok(lock)
}

pub(super) fn location_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| plain_path(&dir).join("storage-location.json"))
        .map_err(|_| "无法定位产品配置目录".to_string())
}

pub(super) fn saved_storage_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let file = location_file(app)?;
    read_storage_location(&file)
}

pub(super) fn read_storage_location(file: &Path) -> Result<Option<PathBuf>, String> {
    if !filesystem_path(file).exists() {
        return Ok(None);
    }
    let value: Value = serde_json::from_slice(
        &fs::read(filesystem_path(file)).map_err(|_| "读取存储定位文件失败".to_string())?,
    )
    .map_err(|_| "存储定位文件损坏".to_string())?;
    if value.get("schema").and_then(Value::as_u64) != Some(1) {
        return Err("存储定位文件版本不兼容".into());
    }
    let path = value
        .get("storage_path")
        .and_then(Value::as_str)
        .ok_or("存储定位文件缺少路径")?;
    let selected = plain_path(Path::new(path));
    if !selected.is_absolute() {
        return Err("存储定位文件中的路径不是绝对路径".into());
    }
    Ok(Some(selected))
}

pub(super) fn save_storage_path(app: &AppHandle, selected: &Path) -> Result<(), String> {
    let file = location_file(app)?;
    write_storage_location(&file, selected)
}

pub(super) fn write_storage_location(file: &Path, selected: &Path) -> Result<(), String> {
    if !selected.is_absolute() {
        return Err("存储位置必须是绝对路径".into());
    }
    write_location_json(
        file,
        &json!({"schema": 1, "storage_path": plain_path(selected).to_string_lossy()}),
    )
}

pub(super) fn write_location_json(file: &Path, value: &Value) -> Result<(), String> {
    let parent = file.parent().ok_or("存储定位文件路径无效")?;
    fs::create_dir_all(filesystem_path(parent)).map_err(|_| "无法创建产品配置目录".to_string())?;
    let temporary = parent.join(format!("storage-location-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec(value).map_err(|_| "无法编码存储定位文件".to_string())?;
    fs::write(filesystem_path(&temporary), bytes)
        .map_err(|_| "无法写入存储定位文件".to_string())?;
    if super::remote_config::replace_file(&temporary, file).is_err() {
        let _ = fs::remove_file(filesystem_path(&temporary));
        return Err("无法启用存储定位文件".into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/location.rs"]
mod tests;
