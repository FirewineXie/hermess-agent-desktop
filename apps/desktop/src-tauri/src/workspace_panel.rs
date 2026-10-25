use crate::errors::DesktopFailure;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{fs, path::Path};

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
