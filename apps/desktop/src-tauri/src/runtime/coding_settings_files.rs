use super::{coding_config, coding_settings, coding_vault};
use crate::{
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path},
};
use serde_json::{json, Value};
use std::{fs, path::Path};
use tauri::AppHandle;

pub(super) fn regular(path: &Path) -> Result<(), DesktopFailure> {
    if let Ok(meta) = fs::symlink_metadata(filesystem_path(path)) {
        let mut linked = meta.file_type().is_symlink();
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            linked |= meta.file_attributes() & 0x400 != 0;
        }
        if linked {
            return Err(DesktopFailure::invalid_input());
        }
    }
    Ok(())
}
fn read(path: &Path) -> Result<String, DesktopFailure> {
    regular(path)?;
    match fs::read_to_string(filesystem_path(path)) {
        Ok(value) if value.len() <= 1024 * 1024 => Ok(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        _ => Err(DesktopFailure::operation_failed()),
    }
}
fn snapshot(path: &Path) -> Result<Value, DesktopFailure> {
    let content = read(path)?;
    Ok(
        json!({"revision":coding_settings::revision(content.as_bytes()),"content":content,"path":plain_path(path)}),
    )
}
// Called under CodingState.gate, shared with structured settings writes.
pub(super) fn config(
    app: &AppHandle,
    update: Option<(String, String)>,
) -> Result<Value, DesktopFailure> {
    let operation = uuid::Uuid::new_v4();
    let action = if update.is_some() { "save" } else { "read" };
    coding_config::log(
        app,
        &format!("programming_config_file_{action}_start operation={operation}"),
    );
    let result = (|| {
        let path = coding_config::owned(app, Path::new("config.toml"))?;
        if let Some((revision, content)) = update {
            if content.len() > 1024 * 1024 || content.contains('\0') {
                return Err(DesktopFailure::invalid_input());
            }
            let before = snapshot(&path)?;
            if before["revision"].as_str() != Some(revision.as_str()) {
                return Err(DesktopFailure::conflict());
            }
            content
                .parse::<toml::Table>()
                .map_err(|_| DesktopFailure::invalid_input())?;
            coding_vault::private_directory(&coding_config::root(app)?)?;
            coding_config::write_bytes(&path, content.as_bytes())?;
        }
        snapshot(&path)
    })();
    coding_config::log(
        app,
        &format!(
            "{}programming_config_file_{action}_result operation={operation} success={}",
            if result.is_err() { "ERROR " } else { "" },
            result.is_ok()
        ),
    );
    result
}
pub(super) fn instruction(
    app: &AppHandle,
    cwd: String,
    revision: Option<String>,
    content: Option<String>,
) -> Result<Value, DesktopFailure> {
    let cwd = super::chat_create::validate_workspace_path(Some(cwd))?
        .ok_or_else(DesktopFailure::invalid_input)?;
    if !super::coding_projects::list(app)?
        .iter()
        .any(|p| p.cwd == cwd)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let path = Path::new(&cwd).join("AGENTS.md");
    if let Some(content) = content {
        if content.len() > 1024 * 1024 {
            return Err(DesktopFailure::invalid_input());
        }
        let before = snapshot(&path)?;
        if revision.as_deref() != before["revision"].as_str() {
            return Err(DesktopFailure::conflict());
        }
        let operation = uuid::Uuid::new_v4();
        coding_config::log(
            app,
            &format!("programming_project_instruction_save_start operation={operation}"),
        );
        let result = coding_config::write_bytes(&path, content.as_bytes());
        coding_config::log(
            app,
            &format!(
                "{}programming_project_instruction_save_result operation={operation} success={}",
                if result.is_err() { "ERROR " } else { "" },
                result.is_ok()
            ),
        );
        result?;
    }
    snapshot(&path)
}
pub(super) fn open_skills(app: &AppHandle) -> Result<(), DesktopFailure> {
    let operation = uuid::Uuid::new_v4();
    coding_config::log(
        app,
        &format!("programming_skills_directory_open_start operation={operation}"),
    );
    let result = (|| {
        let directory = coding_config::owned(app, Path::new("skills"))?;
        coding_vault::private_directory(&directory)?;
        tauri_plugin_opener::open_path(plain_path(&directory), None::<&str>)
            .map_err(|_| DesktopFailure::operation_failed())
    })();
    coding_config::log(
        app,
        &format!(
            "{}programming_skills_directory_open_result operation={operation} success={}",
            if result.is_err() { "ERROR " } else { "" },
            result.is_ok()
        ),
    );
    result
}

#[cfg(test)]
#[path = "tests/coding_config_file.rs"]
mod tests;
