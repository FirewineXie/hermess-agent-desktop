use crate::errors::DesktopFailure;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
pub struct PanelDirectory {
    path: String,
    name: String,
    entries: Vec<PanelEntry>,
}

#[derive(Serialize)]
pub struct PanelEntry {
    path: String,
    name: String,
    directory: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOwner {
    kind: String,
    profile: String,
    session_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct WorkspaceScope {
    kind: String,
    path: String,
    owner: Option<WorkspaceOwner>,
}

impl WorkspaceScope {
    pub fn root(&self) -> Result<PathBuf, DesktopFailure> {
        if self.kind != "workspace"
            || self.owner.as_ref().is_some_and(|owner| {
                owner.kind != "session"
                    || owner.profile.is_empty()
                    || owner.profile.len() > 64
                    || !owner.profile.bytes().all(|byte| {
                        byte.is_ascii_lowercase()
                            || byte.is_ascii_digit()
                            || byte == b'-'
                            || byte == b'_'
                    })
                    || owner.session_id.is_empty()
                    || owner.session_id.len() > 256
            })
        {
            return Err(DesktopFailure::invalid_input());
        }
        let root = if self.path.is_empty() {
            std::env::current_dir().map_err(|_| DesktopFailure::operation_failed())?
        } else {
            PathBuf::from(&self.path)
        };
        if !root.is_absolute() || !root.is_dir() {
            return Err(DesktopFailure::invalid_input());
        }
        Ok(root)
    }

    pub fn checked_path(&self, path: Option<&str>) -> Result<PathBuf, DesktopFailure> {
        let root = self
            .root()?
            .canonicalize()
            .map_err(|_| DesktopFailure::invalid_input())?;
        let target = path
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| root.clone());
        if !target.is_absolute() {
            return Err(DesktopFailure::invalid_input());
        }
        let target = target
            .canonicalize()
            .map_err(|_| DesktopFailure::invalid_input())?;
        if !target.starts_with(root) {
            return Err(DesktopFailure::invalid_input());
        }
        Ok(target)
    }
}

#[tauri::command]
pub fn list_workspace_panel_directory(
    scope: WorkspaceScope,
    path: Option<String>,
) -> Result<PanelDirectory, DesktopFailure> {
    let directory = scope.checked_path(path.as_deref())?;
    if !directory.is_dir() {
        return Err(DesktopFailure::invalid_input());
    }
    let mut entries = fs::read_dir(&directory)
        .map_err(|_| DesktopFailure::operation_failed())?
        .map(|entry| {
            let entry = entry.map_err(|_| DesktopFailure::operation_failed())?;
            let file_type = entry
                .file_type()
                .map_err(|_| DesktopFailure::operation_failed())?;
            // Do not follow directory symlinks while expanding the workspace tree.
            Ok(PanelEntry {
                path: entry.path().to_string_lossy().into_owned(),
                name: entry.file_name().to_string_lossy().into_owned(),
                directory: file_type.is_dir(),
            })
        })
        .collect::<Result<Vec<_>, DesktopFailure>>()?;
    entries.sort_by(|left, right| {
        right
            .directory
            .cmp(&left.directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    let name = directory
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| directory.to_string_lossy().into_owned());
    Ok(PanelDirectory {
        path: directory.to_string_lossy().into_owned(),
        name,
        entries,
    })
}

#[derive(Serialize)]
pub struct PanelFile {
    path: String,
    name: String,
    kind: &'static str,
    content: String,
    mime: Option<&'static str>,
}

#[tauri::command]
pub fn read_workspace_panel_file(
    scope: WorkspaceScope,
    path: String,
) -> Result<PanelFile, DesktopFailure> {
    let checked = scope.checked_path(Some(&path))?;
    let source = Path::new(&checked);
    if !source.is_file() {
        return Err(DesktopFailure::invalid_input());
    }
    let size = fs::metadata(source)
        .map_err(|_| DesktopFailure::operation_failed())?
        .len();
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    };
    let (kind, content) = if let Some(mime) = mime {
        if size > 8 * 1024 * 1024 {
            return Err(DesktopFailure::invalid_input());
        }
        let data = fs::read(source).map_err(|_| DesktopFailure::operation_failed())?;
        (
            "image",
            format!("data:{mime};base64,{}", STANDARD.encode(data)),
        )
    } else if size <= 2 * 1024 * 1024 {
        let data = fs::read(source).map_err(|_| DesktopFailure::operation_failed())?;
        match String::from_utf8(data) {
            Ok(value) => ("text", value),
            Err(_) => ("unsupported", String::new()),
        }
    } else {
        ("unsupported", String::new())
    };
    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(PanelFile {
        path,
        name,
        kind,
        content,
        mime,
    })
}

#[cfg(test)]
#[path = "tests/workspace_panel.rs"]
mod tests;
