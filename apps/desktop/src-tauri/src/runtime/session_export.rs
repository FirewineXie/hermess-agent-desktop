use super::BackendState;
use crate::errors::DesktopFailure;
use crate::paths::{filesystem_path, plain_path};
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf};
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn export_chat_session(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    format: String,
    redact: bool,
    path: String,
) -> Result<String, DesktopFailure> {
    if session_id.is_empty()
        || session_id.len() > 256
        || !matches!(format.as_str(), "json" | "md" | "html")
    {
        return Err(DesktopFailure::invalid_input());
    }
    let selected = plain_path(PathBuf::from(&path).as_path());
    if !selected.is_absolute()
        || selected.extension().and_then(|value| value.to_str()) != Some(format.as_str())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4();
    let log = |step: &str| {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!("session_export_{step} operation={operation} profile={profile} session={session_id} format={format} redact={redact}"),
        );
    };
    log("start");
    let result: Result<String, DesktopFailure> = async {
        let response = scope
            .gateway
            .request(
                "session.export",
                json!({
                    "session_id": session_id,
                    "format": format,
                    "redact": redact,
                }),
            )
            .await?;
        let content = response
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(DesktopFailure::operation_failed)?
            .to_owned();
        if response.get("format").and_then(Value::as_str) != Some(format.as_str()) {
            return Err(DesktopFailure::operation_failed());
        }
        log("rendered");
        let output = selected.clone();
        let cleanup_ok =
            tokio::task::spawn_blocking(move || write_new_export(&output, content.as_bytes()))
                .await
                .map_err(|_| DesktopFailure::operation_failed())??;
        if !cleanup_ok {
            log("cleanup_failed");
        }
        Ok(selected.to_string_lossy().into_owned())
    }
    .await;
    log(if result.is_ok() {
        "completed"
    } else {
        "failed"
    });
    result
}

fn write_new_export(path: &PathBuf, content: &[u8]) -> Result<bool, DesktopFailure> {
    let temporary = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("export"),
        Uuid::new_v4(),
    ));
    let temporary_fs = filesystem_path(&temporary);
    let target_fs = filesystem_path(path);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_fs)
        .map_err(|_| DesktopFailure::operation_failed())?;
    let result = (|| {
        file.write_all(content)
            .map_err(|_| DesktopFailure::operation_failed())?;
        file.sync_all()
            .map_err(|_| DesktopFailure::operation_failed())?;
        drop(file);
        // Creating the final name as a hard link is atomic and cannot overwrite an existing file.
        fs::hard_link(&temporary_fs, &target_fs).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                DesktopFailure::conflict()
            } else {
                DesktopFailure::operation_failed()
            }
        })
    })();
    let cleanup = fs::remove_file(&temporary_fs);
    result.map(|()| cleanup.is_ok())
}

#[cfg(test)]
#[path = "tests/session_export.rs"]
mod tests;
