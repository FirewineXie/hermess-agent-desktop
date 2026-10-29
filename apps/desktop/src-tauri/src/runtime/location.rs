use crate::paths::{filesystem_path, plain_path};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

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

fn location_file(app: &AppHandle) -> Result<PathBuf, String> {
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
    let parent = file.parent().ok_or("存储定位文件路径无效")?;
    fs::create_dir_all(filesystem_path(parent)).map_err(|_| "无法创建产品配置目录".to_string())?;
    let temporary = parent.join(format!("storage-location-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec(
        &json!({"schema": 1, "storage_path": plain_path(selected).to_string_lossy()}),
    )
    .map_err(|_| "无法编码存储定位文件".to_string())?;
    fs::write(filesystem_path(&temporary), bytes)
        .map_err(|_| "无法写入存储定位文件".to_string())?;
    if let Err(error) = fs::rename(filesystem_path(&temporary), filesystem_path(file)) {
        let _ = fs::remove_file(filesystem_path(&temporary));
        return Err(format!("无法启用存储定位文件：{error}"));
    }
    Ok(())
}
