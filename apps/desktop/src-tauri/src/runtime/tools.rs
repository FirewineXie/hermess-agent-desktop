use super::{
    config::{config_request_for_scope, config_request_to_profile},
    hermes_process_path,
    profile_scope::ResolvedProfileScope,
    BackendState, BundledTool, BundledToolsInventory,
};
use crate::errors::DesktopFailure;
use crate::paths::filesystem_path;
use crate::process_manager;
use reqwest::Method;
use serde_json::json;
use serde_json::Value;
use std::{
    fs,
    path::{Component, Path},
    process::Stdio,
    time::Duration,
};
use tauri::State;
use tokio::{process::Command, time::timeout};
use uuid::Uuid;

const STT_TOGGLE_ROUTE: &str = "/api/tools/toolsets/stt";

fn stt_toggle_body(enabled: bool) -> Value {
    json!({"enabled": enabled})
}

fn toggle_args(profile: &str, platform: &str, name: &str, enabled: bool) -> Vec<String> {
    vec![
        "-p".into(),
        profile.into(),
        "tools".into(),
        if enabled { "enable" } else { "disable" }.into(),
        name.into(),
        "--platform".into(),
        platform.into(),
    ]
}

#[tauri::command]
pub async fn list_bundled_tools(
    state: State<'_, BackendState>,
) -> Result<BundledToolsInventory, DesktopFailure> {
    let root = {
        let owned = state.0.lock().await;
        owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?
            .bundled_tools_root
            .clone()
    };
    let Some(root) = root else {
        return Ok(BundledToolsInventory {
            has_manifest: false,
            tools: Vec::new(),
        });
    };
    let facts_path = root.join("facts.json");
    let metadata = fs::metadata(&facts_path).map_err(|_| "运行时工具清单缺失".to_string())?;
    if metadata.len() > 1024 * 1024 {
        return Err("运行时工具清单过大".into());
    }
    let facts: Value = serde_json::from_slice(
        &fs::read(&facts_path).map_err(|_| "无法读取运行时工具清单".to_string())?,
    )
    .map_err(|_| "运行时工具清单格式无效".to_string())?;
    let packages = facts
        .get("packages")
        .and_then(Value::as_object)
        .ok_or("运行时工具清单缺少包列表")?;
    let mut tools = Vec::new();
    for (name, package) in packages.iter().take(256) {
        let Some(entry) = package.get("entry").and_then(Value::as_str) else {
            continue;
        };
        let mut components = Path::new(entry).components();
        if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
            continue;
        }
        let path = root.join(entry);
        tools.push(BundledTool {
            name: name.clone(),
            version: package
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            path: path.to_string_lossy().into_owned(),
            present: path.is_dir(),
        });
    }
    Ok(BundledToolsInventory {
        has_manifest: true,
        tools,
    })
}

#[tauri::command]
pub async fn list_profile_toolsets(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let rows = config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/tools/toolsets",
        None,
    )
    .await?;
    if !rows.is_array() {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(rows)
}

pub(super) async fn toggle_profile_toolset(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty() && name.len() <= 100 && !name.chars().any(char::is_control))
        .ok_or_else(DesktopFailure::invalid_input)?;
    let enabled = payload
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(DesktopFailure::invalid_input)?;
    let rows =
        config_request_for_scope(state, scope, Method::GET, "/api/tools/toolsets", None).await?;
    let target = rows
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("name").and_then(Value::as_str) == Some(name))
        })
        .ok_or_else(DesktopFailure::invalid_input)?;
    let platform = target
        .get("platform")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty() && value.len() <= 100 && !value.chars().any(char::is_control)
        })
        .ok_or_else(DesktopFailure::operation_failed)?;
    let operation_id = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("toolset_toggle_start operation_id={operation_id} profile={} toolset={name} enabled={enabled}", scope.profile),
    );
    let result = async {
        scope.ensure_current(state).await?;
        if name == "stt" {
            config_request_for_scope(
                state,
                scope,
                Method::PUT,
                STT_TOGGLE_ROUTE,
                Some(stt_toggle_body(enabled)),
            )
            .await?;
        } else {
            let _install_gate = state.1.try_lock().map_err(|_| DesktopFailure::conflict())?;
            let dir = scope
                .storage
                .join("logs")
                .join("toolsets")
                .join(&scope.profile);
            fs::create_dir_all(filesystem_path(&dir))
                .map_err(|_| DesktopFailure::operation_failed())?;
            let log = fs::File::create(filesystem_path(
                &dir.join(format!("toggle-{operation_id}.log")),
            ))
            .map_err(|_| DesktopFailure::operation_failed())?;
            let stderr = log
                .try_clone()
                .map_err(|_| DesktopFailure::operation_failed())?;
            let mut command = Command::new(&scope.hermes);
            command
                .args(toggle_args(&scope.profile, platform, name, enabled))
                .env(
                    "HERMES_HOME",
                    hermes_process_path(&scope.storage.join("hermes-home")),
                )
                .env(
                    "HERMES_GATEWAY_LOCK_DIR",
                    hermes_process_path(&scope.storage.join("control").join("gateway-locks")),
                )
                .env("HERMES_DESKTOP", "1")
                .env("HERMES_DISABLE_LAZY_INSTALLS", "1")
                .stdin(Stdio::null())
                .stdout(Stdio::from(log))
                .stderr(Stdio::from(stderr))
                .kill_on_drop(true);
            #[cfg(windows)]
            command.creation_flags(0x0800_0000);
            let status = timeout(
                Duration::from_secs(120),
                process_manager::status(&mut command, "toolset_toggle"),
            )
            .await
            .map_err(|_| DesktopFailure::timeout())?
            .map_err(|_| DesktopFailure::operation_failed())?;
            if !status.success() {
                return Err(DesktopFailure::operation_failed());
            }
        }
        scope.ensure_current(state).await?;
        let current =
            config_request_for_scope(state, scope, Method::GET, "/api/tools/toolsets", None)
                .await?;
        let actual = current
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item.get("name").and_then(Value::as_str) == Some(name))
            })
            .and_then(|item| item.get("enabled"))
            .and_then(Value::as_bool)
            .ok_or_else(DesktopFailure::operation_failed)?;
        if actual != enabled {
            return Err(DesktopFailure::operation_failed());
        }
        Ok(json!({"ok": true, "name": name, "enabled": actual}))
    }
    .await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("toolset_toggle_{outcome} operation_id={operation_id} profile={} toolset={name} enabled={enabled}", scope.profile),
    );
    result
}

pub(super) async fn validate_post_setup_key(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    name: &str,
    key: &str,
) -> Result<(), DesktopFailure> {
    if name.is_empty()
        || name.len() > 100
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        || key.is_empty()
        || key.len() > 100
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let rows =
        config_request_for_scope(state, scope, Method::GET, "/api/tools/toolsets", None).await?;
    if !rows.as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item.get("name").and_then(Value::as_str) == Some(name))
    }) {
        return Err(DesktopFailure::invalid_input());
    }
    let route = format!("/api/tools/toolsets/{name}/config");
    let config = config_request_for_scope(state, scope, Method::GET, &route, None).await?;
    if !config
        .get("providers")
        .and_then(Value::as_array)
        .is_some_and(|providers| {
            providers
                .iter()
                .any(|provider| provider.get("post_setup").and_then(Value::as_str) == Some(key))
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/tools.rs"]
mod tests;
