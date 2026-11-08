use super::{coding_config, coding_runtime, coding_vault, coding_worker};
use crate::{
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path},
    process_manager,
};
use serde_json::{json, Value};
use std::{fs, path::Path, time::Duration};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

pub(super) fn validate(id: &str) -> Result<(), DesktopFailure> {
    if [
        "request",
        "auto",
        "full",
        "custom",
        "hermess",
        "hermess-readonly",
    ]
    .contains(&id)
    {
        Ok(())
    } else {
        Err(DesktopFailure::invalid_input())
    }
}

pub(super) fn open_config(app: &AppHandle) -> Result<(), DesktopFailure> {
    let root = coding_config::root(app)?;
    coding_vault::private_directory(&root)?;
    let path = coding_config::owned(app, Path::new("config.toml"))?;
    if !filesystem_path(&path).exists() {
        coding_config::write_bytes(&path, b"# Hermess programming configuration. Separate from personal Codex.\nmodel_reasoning_effort = \"medium\"\napproval_policy = \"on-request\"\ndefault_permissions = \"hermess\"\n")?;
    }
    let result = tauri_plugin_opener::open_path(plain_path(&path), None::<&str>)
        .map_err(|_| DesktopFailure::operation_failed());
    coding_config::log(
        app,
        &format!(
            "{}programming_permission_config_open success={}",
            if result.is_err() { "ERROR " } else { "" },
            result.is_ok()
        ),
    );
    result
}

pub(super) async fn list(app: &AppHandle, cwd: String) -> Result<Value, DesktopFailure> {
    discover(app, cwd, "permissions").await
}

pub(super) async fn skills(app: &AppHandle, cwd: String) -> Result<Value, DesktopFailure> {
    discover(app, cwd, "skills").await
}

async fn discover(app: &AppHandle, cwd: String, action: &str) -> Result<Value, DesktopFailure> {
    let operation = uuid::Uuid::new_v4();
    coding_config::log(
        app,
        &format!("programming_discovery_start operation={operation} action={action}"),
    );
    let relative = Path::new("permission-discovery").join(operation.to_string());
    let home = coding_config::owned(app, &relative)?;
    coding_vault::private_directory(&home)?;
    let result = async {
        let cwd = if cwd.is_empty() { plain_path(&home).to_string_lossy().into_owned() }
            else { super::chat_create::validate_workspace_path(Some(cwd))?.ok_or_else(DesktopFailure::invalid_input)? };
        let executable = coding_runtime::executable(app)?;
        let hermes = coding_worker::hermes_runtime(app)?;
        let mut command = coding_worker::command(&hermes, &home)?;
        let payload = json!({"integration":super::coding_settings::payload(app)?, "action":action, "home":plain_path(&home), "private_root":coding_config::root(app)?,
            "cwd":cwd, "executable":plain_path(&executable), "connection_id":"permission-discovery",
            "model":"permission-discovery", "base_url":"https://unused.invalid/v1", "effort":"medium", "api_key":"NOT_USED"});
        let (mut child, registration) = process_manager::spawn(&mut command, "coding_permissions")
            .map_err(|_| DesktopFailure::operation_failed())?;
        let request = async {
            let mut input = child.stdin.take().ok_or_else(DesktopFailure::operation_failed)?;
            input.write_all(format!("{payload}\n").as_bytes()).await.map_err(|_| DesktopFailure::operation_failed())?;
            drop(input);
            let output = child.wait_with_output().await.map_err(|_| DesktopFailure::operation_failed())?;
            if !output.status.success() || output.stdout.len() > 1024 * 1024 { return Err(DesktopFailure::operation_failed()); }
            output.stdout.split(|byte| *byte == b'\n').filter_map(|line| serde_json::from_slice::<Value>(line).ok())
                .find(|event| event["kind"] == action).and_then(|event| event.get(if action == "skills" { "catalog" } else { "profiles" }).cloned())
                .ok_or_else(DesktopFailure::operation_failed)
        };
        let result = tokio::time::timeout(Duration::from_secs(30), request).await.map_err(|_| DesktopFailure::timeout());
        let cleanup = registration.terminate_tree().await;
        cleanup.map_err(|_| DesktopFailure::operation_failed())?;
        result?
    }.await;
    let cleaned = fs::remove_dir_all(filesystem_path(&home)).is_ok();
    coding_config::log(
        app,
        &format!(
            "{}programming_discovery_result operation={operation} action={action} success={} cleanup={cleaned}",
            if result.is_err() || !cleaned {
                "ERROR "
            } else {
                ""
            },
            result.is_ok()
        ),
    );
    if !cleaned {
        return Err(DesktopFailure::operation_failed());
    }
    result
}
