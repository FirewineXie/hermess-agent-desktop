use super::{profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use crate::paths::{filesystem_path, plain_path, CanonicalizePlain};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::State;
use uuid::Uuid;

const MAX_TEXT_PREVIEW: u64 = 512 * 1024;
const MAX_IMAGE_PREVIEW: u64 = 8 * 1024 * 1024;

fn field<'a>(payload: &'a Value, key: &str, max: usize) -> Result<&'a str, DesktopFailure> {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn sensitive(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if name == ".env" || name.starts_with(".env.") || name == ".envrc" {
        return true;
    }
    if [
        "auth.json",
        "auth.lock",
        "credentials",
        "config.yaml",
        ".anthropic_oauth.json",
        "google_token.json",
        "google_oauth_pending.json",
        "google_oauth.json",
        "webhook_subscriptions.json",
        "bws_cache.json",
        "bws_cache.enc.json",
        ".git-credentials",
    ]
    .contains(&name.as_str())
    {
        return true;
    }
    path.components().any(|component| match component {
        Component::Normal(name) => ["mcp-tokens", "pairing"]
            .contains(&name.to_string_lossy().to_ascii_lowercase().as_str()),
        _ => false,
    })
}

fn plain(path: &Path) -> String {
    plain_path(path).to_string_lossy().into_owned()
}

fn root(home: &Path, payload: &Value) -> Result<PathBuf, DesktopFailure> {
    let chosen = payload
        .get("root")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if chosen.len() > 4096 || chosen.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let path = if chosen.is_empty() {
        home.to_path_buf()
    } else {
        plain_path(Path::new(chosen))
    };
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return Err(DesktopFailure::invalid_input());
    }
    let canonical = filesystem_path(&path)
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::invalid_input())?;
    if !filesystem_path(&canonical).is_dir() || sensitive(&canonical) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(canonical)
}

fn existing(root: &Path, path: &str) -> Result<PathBuf, DesktopFailure> {
    let plain_target = if path.is_empty() {
        root.to_path_buf()
    } else {
        plain_path(Path::new(path))
    };
    if !plain_target.is_absolute()
        || plain_target
            .components()
            .any(|part| part == Component::ParentDir)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let metadata = fs::symlink_metadata(filesystem_path(&plain_target))
        .map_err(|_| DesktopFailure::invalid_input())?;
    if metadata.file_type().is_symlink() {
        return Err(DesktopFailure::invalid_input());
    }
    let target = filesystem_path(&plain_target)
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::invalid_input())?;
    if !target.starts_with(root) || sensitive(&target) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(target)
}

fn target_for_name(root: &Path, parent: &str, name: &str) -> Result<PathBuf, DesktopFailure> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.len() > 255
        || name
            .chars()
            .any(|ch| ch.is_control() || "\\/:*?\"<>|".contains(ch))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let parent = existing(root, parent)?;
    if !filesystem_path(&parent).is_dir() {
        return Err(DesktopFailure::invalid_input());
    }
    let target = parent.join(name);
    if sensitive(&target) {
        return Err(DesktopFailure::invalid_input());
    }
    if let Ok(metadata) = fs::symlink_metadata(filesystem_path(&target)) {
        if metadata.file_type().is_symlink() {
            return Err(DesktopFailure::invalid_input());
        }
    }
    Ok(target)
}

fn entry(path: &Path) -> Result<Value, DesktopFailure> {
    let metadata = fs::symlink_metadata(filesystem_path(path))
        .map_err(|_| DesktopFailure::operation_failed())?;
    let symlink = metadata.file_type().is_symlink();
    let directory = metadata.is_dir();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_secs_f64());
    Ok(
        json!({"name":path.file_name().map(|name|name.to_string_lossy().into_owned()).unwrap_or_default(),
        "path":plain(path),"is_directory":directory,"broken_link":symlink,
        "size":if directory { None } else { Some(metadata.len()) },"mtime":modified}),
    )
}

fn atomic_copy(source: &Path, target: &Path) -> Result<(), DesktopFailure> {
    let metadata = fs::symlink_metadata(filesystem_path(source))
        .map_err(|_| DesktopFailure::invalid_input())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(DesktopFailure::invalid_input());
    }
    if source == target {
        return Err(DesktopFailure::invalid_input());
    }
    let name = target
        .file_name()
        .ok_or_else(DesktopFailure::invalid_input)?
        .to_string_lossy();
    let temporary = target.with_file_name(format!(".{name}.{}.upload", Uuid::new_v4()));
    let result = (|| {
        fs::copy(filesystem_path(source), filesystem_path(&temporary))
            .map_err(|_| DesktopFailure::operation_failed())?;
        replace_file(&temporary, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(filesystem_path(&temporary));
    }
    result
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> Result<(), DesktopFailure> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let wide = |path: &Path| {
        filesystem_path(path)
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let (source, target) = (wide(source), wide(target));
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(DesktopFailure::operation_failed())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> Result<(), DesktopFailure> {
    fs::rename(filesystem_path(source), filesystem_path(target))
        .map_err(|_| DesktopFailure::operation_failed())
}

fn operate(home: &Path, operation: &str, payload: &Value) -> Result<Value, DesktopFailure> {
    let root = root(home, payload)?;
    match operation {
        "managedFiles.list" => {
            let path = existing(
                &root,
                payload.get("path").and_then(Value::as_str).unwrap_or(""),
            )?;
            if !filesystem_path(&path).is_dir() {
                return Err(DesktopFailure::invalid_input());
            }
            let mut entries = fs::read_dir(filesystem_path(&path))
                .map_err(|_| DesktopFailure::operation_failed())?
                .map(|item| item.map_err(|_| DesktopFailure::operation_failed()))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .map(|item| item.path())
                .filter(|path| !sensitive(path))
                .map(|path| entry(&path))
                .collect::<Result<Vec<_>, _>>()?;
            entries.sort_by(|a, b| {
                b["is_directory"]
                    .as_bool()
                    .cmp(&a["is_directory"].as_bool())
                    .then_with(|| {
                        a["name"]
                            .as_str()
                            .unwrap_or("")
                            .to_lowercase()
                            .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
                    })
            });
            let parent = if path == root {
                None
            } else {
                path.parent().map(plain)
            };
            Ok(json!({"root":plain(&root),"path":plain(&path),"parent":parent,"entries":entries}))
        }
        "managedFiles.read" => {
            let path = existing(&root, field(payload, "path", 4096)?)?;
            let metadata = fs::metadata(filesystem_path(&path))
                .map_err(|_| DesktopFailure::operation_failed())?;
            if !metadata.is_file() {
                return Err(DesktopFailure::invalid_input());
            }
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let mime = match extension.as_str() {
                "png" => Some("image/png"),
                "jpg" | "jpeg" => Some("image/jpeg"),
                "gif" => Some("image/gif"),
                "webp" => Some("image/webp"),
                "bmp" => Some("image/bmp"),
                _ => None,
            };
            let (kind, content) =
                if let Some(mime) = mime.filter(|_| metadata.len() <= MAX_IMAGE_PREVIEW) {
                    let bytes = fs::read(filesystem_path(&path))
                        .map_err(|_| DesktopFailure::operation_failed())?;
                    (
                        "image",
                        format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
                    )
                } else if metadata.len() <= MAX_TEXT_PREVIEW {
                    let bytes = fs::read(filesystem_path(&path))
                        .map_err(|_| DesktopFailure::operation_failed())?;
                    match String::from_utf8(bytes) {
                        Ok(text) => ("text", text),
                        Err(_) => ("unsupported", String::new()),
                    }
                } else {
                    ("unsupported", String::new())
                };
            Ok(
                json!({"path":plain(&path),"name":path.file_name().unwrap_or_default().to_string_lossy(),"kind":kind,"content":content}),
            )
        }
        "managedFiles.mkdir" => {
            let target = target_for_name(
                &root,
                field(payload, "path", 4096)?,
                field(payload, "name", 255)?,
            )?;
            fs::create_dir(filesystem_path(&target))
                .map_err(|_| DesktopFailure::operation_failed())?;
            Ok(json!({"ok":true,"path":plain(&target)}))
        }
        "managedFiles.upload" => {
            let parent = field(payload, "path", 4096)?;
            let sources = payload
                .get("sources")
                .and_then(Value::as_array)
                .filter(|items| !items.is_empty() && items.len() <= 100)
                .ok_or_else(DesktopFailure::invalid_input)?;
            let mut copied = 0;
            for source in sources {
                let source = source.as_str().ok_or_else(DesktopFailure::invalid_input)?;
                let source = plain_path(Path::new(source));
                if !source.is_absolute() {
                    return Err(DesktopFailure::invalid_input());
                }
                let name = source
                    .file_name()
                    .ok_or_else(DesktopFailure::invalid_input)?
                    .to_string_lossy();
                let target = target_for_name(&root, parent, &name)?;
                atomic_copy(&source, &target)?;
                copied += 1;
            }
            Ok(json!({"ok":true,"copied":copied}))
        }
        "managedFiles.delete" => {
            let target = existing(&root, field(payload, "path", 4096)?)?;
            if target == root {
                return Err(DesktopFailure::invalid_input());
            }
            let metadata = fs::metadata(filesystem_path(&target))
                .map_err(|_| DesktopFailure::operation_failed())?;
            let result = if metadata.is_dir() {
                fs::remove_dir_all(filesystem_path(&target))
            } else {
                fs::remove_file(filesystem_path(&target))
            };
            result.map_err(|_| DesktopFailure::operation_failed())?;
            Ok(json!({"ok":true,"path":plain(&target)}))
        }
        "managedFiles.copyOut" => {
            let source = existing(&root, field(payload, "path", 4096)?)?;
            let destination = plain_path(Path::new(field(payload, "destination", 4096)?));
            if !destination.is_absolute()
                || !filesystem_path(
                    destination
                        .parent()
                        .ok_or_else(DesktopFailure::invalid_input)?,
                )
                .is_dir()
            {
                return Err(DesktopFailure::invalid_input());
            }
            atomic_copy(&source, &destination)?;
            Ok(json!({"ok":true,"path":plain(&destination)}))
        }
        _ => Err(DesktopFailure::invalid_input()),
    }
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let home = scope.home.clone();
    let operation_owned = operation.to_owned();
    let payload_owned = payload.clone();
    let write = matches!(
        operation,
        "managedFiles.mkdir"
            | "managedFiles.upload"
            | "managedFiles.delete"
            | "managedFiles.copyOut"
    );
    let id = Uuid::new_v4();
    if write {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "managed_files action={operation} operation={id} profile={} phase=start",
                scope.profile
            ),
        );
    }
    let result =
        tokio::task::spawn_blocking(move || operate(&home, &operation_owned, &payload_owned))
            .await
            .unwrap_or_else(|_| Err(DesktopFailure::operation_failed()));
    if write {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "managed_files action={operation} operation={id} profile={} status={}",
                scope.profile,
                if result.is_ok() { "ok" } else { "failed" }
            ),
        );
    }
    result
}

#[cfg(test)]
#[path = "tests/managed_files.rs"]
mod tests;
