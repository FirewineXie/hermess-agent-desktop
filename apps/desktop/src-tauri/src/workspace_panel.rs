use crate::errors::DesktopFailure;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
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

#[tauri::command]
pub fn list_workspace_panel_directory(
    path: Option<String>,
) -> Result<PanelDirectory, DesktopFailure> {
    let directory = match path.filter(|value| !value.trim().is_empty()) {
        Some(path) => PathBuf::from(path),
        None => std::env::current_dir().map_err(|_| DesktopFailure::operation_failed())?,
    };
    if !directory.is_absolute() || !directory.is_dir() {
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
pub fn read_workspace_panel_file(path: String) -> Result<PanelFile, DesktopFailure> {
    let source = Path::new(&path);
    if !source.is_absolute() || !source.is_file() {
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
