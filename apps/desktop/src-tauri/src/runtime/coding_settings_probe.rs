use super::{coding_config, coding_runtime, coding_settings, coding_vault, coding_worker};
use crate::{errors::DesktopFailure, paths::plain_path, process_manager};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tauri::AppHandle;
use tokio::io::{AsyncWriteExt, BufReader};

static GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(super) async fn run(
    app: &AppHandle,
    cwd: String,
    server: Option<String>,
    login: bool,
) -> Result<Value, DesktopFailure> {
    let _guard = GATE.lock().await;
    let operation = uuid::Uuid::new_v4();
    coding_config::log(
        app,
        &format!("programming_settings_probe_start operation={operation} login={login}"),
    );
    let result = async {
        let integration = coding_settings::payload(app)?;
        if let Some(id) = &server {
            if !integration["settings"]["mcp_servers"].as_array().is_some_and(|rows| rows.iter().any(|row| row["id"] == *id && row["enabled"] == true)) { return Err(DesktopFailure::invalid_input()); }
        } else if login { return Err(DesktopFailure::invalid_input()); }
        let home = coding_config::owned(app, Path::new("mcp-auth"))?;
        coding_vault::private_directory(&home)?;
        let cwd = if cwd.is_empty() { plain_path(&home).to_string_lossy().into_owned() } else {
            super::chat_create::validate_workspace_path(Some(cwd))?.ok_or_else(DesktopFailure::invalid_input)?
        };
        let hermes = coding_worker::hermes_runtime(app)?;
        let mut command = coding_worker::command(app, &hermes, &home)?;
        let payload = json!({"action":"settings_probe", "integration":integration, "home":plain_path(&home), "private_root":coding_config::root(app)?,
            "cwd":cwd, "executable":plain_path(&coding_runtime::executable(app)?), "connection_id":"settings-probe", "model":"settings-probe",
            "base_url":"https://unused.invalid/v1", "effort":"medium", "api_key":"NOT_USED", "mcp_server":server, "mcp_login":login});
        let (mut child, registration) = process_manager::spawn(&mut command, "coding_permissions").map_err(|_| DesktopFailure::operation_failed())?;
        let request = async {
            let mut input = child.stdin.take().ok_or_else(DesktopFailure::operation_failed)?;
            input.write_all(format!("{payload}\n").as_bytes()).await.map_err(|_| DesktopFailure::operation_failed())?;
            drop(input);
            let mut output = BufReader::new(child.stdout.take().ok_or_else(DesktopFailure::operation_failed)?);
            let mut bytes = Vec::new();
            let mut total = 0;
            let mut result = None;
            while let Some(event) = coding_worker::read_event(&mut output, &mut bytes).await.map_err(|_| DesktopFailure::operation_failed())? {
                total += serde_json::to_vec(&event).map_err(|_| DesktopFailure::operation_failed())?.len();
                if total > 2 * 1024 * 1024 { return Err(DesktopFailure::operation_failed()); }
                if event["kind"] == "authorization_url" {
                    let url = event["url"].as_str().ok_or_else(DesktopFailure::invalid_input)?;
                    let parsed = reqwest::Url::parse(url).map_err(|_| DesktopFailure::invalid_input())?;
                    if !["https", "http"].contains(&parsed.scheme()) { return Err(DesktopFailure::invalid_input()); }
                    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|_| DesktopFailure::operation_failed())?;
                }
                if event["kind"] == "settings_probe" { result = event.get("result").cloned(); }
            }
            if !child.wait().await.map_err(|_| DesktopFailure::operation_failed())?.success() { return Err(DesktopFailure::operation_failed()); }
            result.ok_or_else(DesktopFailure::operation_failed)
        };
        let outcome = tokio::time::timeout(Duration::from_secs(if login { 190 } else { 150 }), request).await.map_err(|_| DesktopFailure::timeout());
        let cleanup = registration.terminate_tree().await;
        let _ = child.wait().await;
        cleanup.map_err(|_| DesktopFailure::operation_failed())?;
        outcome?
    }.await;
    coding_config::log(
        app,
        &format!(
            "{}programming_settings_probe_result operation={operation} success={}",
            if result.is_err() { "ERROR " } else { "" },
            result.is_ok()
        ),
    );
    result
}
