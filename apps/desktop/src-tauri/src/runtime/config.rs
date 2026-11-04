use super::{profile_scope::ResolvedProfileScope, BackendState};
use crate::diagnostics::append_client_event;
use crate::errors::DesktopFailure;
use crate::paths::{filesystem_path, plain_path, CanonicalizePlain};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::State;

pub(super) static CONFIG_WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
fn profile_http_client() -> Result<&'static reqwest::Client, DesktopFailure> {
    super::local_http::client()
}

pub(super) async fn config_request_to_profile(
    state: &State<'_, BackendState>,
    profile: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(profile).await?;
    config_request_for_scope(state, &scope, method, path, body).await
}

pub(super) async fn config_request_for_scope(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let (port, auth_header, token) = scope.http_auth().await?;
    scope.ensure_current(state).await?;
    let result = request_with_auth(
        method,
        path,
        body,
        port,
        auth_header,
        token,
        &scope.storage,
        &scope.profile,
    )
    .await?;
    scope.ensure_current(state).await?;
    Ok(result)
}

async fn request_with_auth(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    port: u16,
    auth_header: &str,
    token: String,
    storage: &Path,
    profile: &str,
) -> Result<Value, DesktopFailure> {
    let method_label = request_method_label(&method);
    let mut request = profile_http_client()?
        .request(method, format!("http://127.0.0.1:{port}{path}"))
        .timeout(std::time::Duration::from_secs(20))
        .header(auth_header, token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "配置请求失败".to_string())?;
    const LIMIT: usize = 50 * 1024 * 1024;
    if response
        .content_length()
        .is_some_and(|size| size > LIMIT as u64)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取配置响应失败".to_string())?
    {
        if bytes.len() + chunk.len() > LIMIT {
            return Err(DesktopFailure::operation_failed());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "配置响应不是有效 JSON".to_string())?;
    if !status.is_success() {
        let _ = append_client_event(
            storage,
            &format!(
                "profile_http_request_failed profile={profile} method={} path={path} status={}",
                method_label,
                status.as_u16()
            ),
        );
        // 上游错误可能包含用户配置或凭据，不向界面透传正文。
        return Err(DesktopFailure::operation_failed());
    }
    Ok(value)
}

fn request_method_label(method: &reqwest::Method) -> &'static str {
    match *method {
        reqwest::Method::GET => "GET",
        reqwest::Method::POST => "POST",
        reqwest::Method::PUT => "PUT",
        reqwest::Method::PATCH => "PATCH",
        reqwest::Method::DELETE => "DELETE",
        _ => "OTHER",
    }
}

#[tauri::command]
pub async fn get_agent_config(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    config_request_to_profile(&state, &profile, reqwest::Method::GET, "/api/config", None).await
}

#[tauri::command]
pub async fn get_agent_config_schema(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/config/schema",
        None,
    )
    .await
}

#[tauri::command]
pub async fn get_agent_config_defaults(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/config/defaults",
        None,
    )
    .await
}

#[tauri::command]
pub async fn get_agent_config_raw(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/config/raw",
        None,
    )
    .await
}

#[tauri::command]
pub async fn get_auxiliary_models(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let path = auxiliary_read_path(&profile)?;
    config_request_to_profile(&state, &profile, reqwest::Method::GET, &path, None).await
}

fn auxiliary_read_path(profile: &str) -> Result<String, DesktopFailure> {
    let mut url = reqwest::Url::parse("http://localhost/api/model/auxiliary")
        .map_err(|_| DesktopFailure::operation_failed())?;
    url.query_pairs_mut().append_pair("profile", profile);
    Ok(format!("{}?{}", url.path(), url.query().unwrap_or("")))
}

fn auxiliary_assignment_request(
    profile: &str,
    task: &str,
    provider: &str,
    model: &str,
    effort: &str,
    confirm_expensive_model: bool,
) -> Result<Value, DesktopFailure> {
    if task.is_empty()
        || task.len() > 80
        || !task
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        || provider.is_empty()
        || provider.len() > 128
        || model.len() > 256
        || (provider != "auto" && model.is_empty())
        || ![
            "", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
        ]
        .contains(&effort)
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(json!({
        "scope": "auxiliary", "task": task, "provider": provider, "model": model,
        "reasoning_effort": if effort.is_empty() { Value::Null } else { json!(effort) },
        "confirm_expensive_model": confirm_expensive_model, "profile": profile,
    }))
}

fn auxiliary_task<'a>(value: &'a Value, task: &str) -> Option<&'a Value> {
    value
        .get("tasks")?
        .as_array()?
        .iter()
        .find(|row| row.get("task").and_then(Value::as_str) == Some(task))
}

fn auxiliary_assignment_matches(
    value: &Value,
    task: &str,
    provider: &str,
    model: &str,
    effort: &str,
) -> bool {
    let Some(row) = auxiliary_task(value, task) else {
        return false;
    };
    row.get("provider").and_then(Value::as_str) == Some(provider)
        && row.get("model").and_then(Value::as_str) == Some(model)
        && if effort.is_empty() {
            row.get("reasoning_effort").is_none_or(Value::is_null)
        } else {
            row.get("reasoning_effort").and_then(Value::as_str) == Some(effort)
        }
}

#[tauri::command]
pub async fn save_auxiliary_route(
    state: State<'_, BackendState>,
    profile: String,
    task: String,
    provider: String,
    model: String,
    effort: String,
    timeout: Option<f64>,
    confirm_expensive_model: Option<bool>,
) -> Result<Value, DesktopFailure> {
    if timeout.is_some_and(|value| !value.is_finite() || value <= 0.0) {
        return Err(DesktopFailure::invalid_input());
    }
    let _guard = CONFIG_WRITE_LOCK.lock().await;
    let provider = provider.trim();
    let model = model.trim();
    let scope = state.resolve_profile(&profile).await?;
    let body = auxiliary_assignment_request(
        &scope.profile,
        &task,
        provider,
        model,
        &effort,
        confirm_expensive_model.unwrap_or(false),
    )?;
    let read_path = auxiliary_read_path(&scope.profile)?;
    let operation = uuid::Uuid::new_v4();
    let _ = append_client_event(
        &scope.storage,
        &format!(
            "auxiliary_model_save_start operation={operation} profile={} task={task}",
            scope.profile
        ),
    );
    let result = async {
        let before =
            config_request_for_scope(&state, &scope, reqwest::Method::GET, &read_path, None)
                .await?;
        if auxiliary_task(&before, &task).is_none() {
            return Err(DesktopFailure::invalid_input());
        }
        let response = config_request_for_scope(
            &state,
            &scope,
            reqwest::Method::POST,
            "/api/model/set",
            Some(body),
        )
        .await?;
        if response.get("confirm_required") == Some(&json!(true)) {
            return Ok(json!({
                "saved": false,
                "confirm_required": true,
                "confirm_message": response.get("confirm_message").and_then(Value::as_str),
            }));
        }
        if response.get("ok") != Some(&json!(true)) {
            return Err(DesktopFailure::operation_failed());
        }
        if let Some(value) = timeout {
            let schema = config_request_for_scope(
                &state,
                &scope,
                reqwest::Method::GET,
                "/api/config/schema",
                None,
            )
            .await?;
            if schema
                .pointer(&format!("/fields/auxiliary.{task}.timeout"))
                .is_none()
            {
                return Err(DesktopFailure::invalid_input());
            }
            let mut route = serde_json::Map::new();
            route.insert("timeout".into(), json!(value));
            let mut auxiliary = serde_json::Map::new();
            auxiliary.insert(task.clone(), Value::Object(route));
            config_request_for_scope(
                &state,
                &scope,
                reqwest::Method::PUT,
                "/api/config",
                Some(json!({"config": {"auxiliary": auxiliary}})),
            )
            .await?;
        }
        let readback =
            config_request_for_scope(&state, &scope, reqwest::Method::GET, &read_path, None)
                .await?;
        if !auxiliary_assignment_matches(&readback, &task, provider, model, &effort) {
            return Err(DesktopFailure::operation_failed());
        }
        if let Some(value) = timeout {
            let config =
                config_request_for_scope(&state, &scope, reqwest::Method::GET, "/api/config", None)
                    .await?;
            if config
                .pointer(&format!("/auxiliary/{task}/timeout"))
                .and_then(Value::as_f64)
                != Some(value)
            {
                return Err(DesktopFailure::operation_failed());
            }
        }
        Ok(json!({"saved": true, "state": readback}))
    }
    .await;
    let outcome = match &result {
        Ok(value) if value.get("confirm_required") == Some(&json!(true)) => "confirmation_required",
        Ok(_) => "completed",
        Err(_) => "failed",
    };
    let _ = append_client_event(
        &scope.storage,
        &format!(
            "auxiliary_model_save_finish operation={operation} profile={} task={task} outcome={outcome}",
            scope.profile
        ),
    );
    result
}

fn auxiliary_reset_request(profile: &str) -> Result<(Value, String), DesktopFailure> {
    Ok((
        json!({"scope": "auxiliary", "task": "__reset__", "provider": "", "model": "", "profile": profile}),
        auxiliary_read_path(profile)?,
    ))
}

#[tauri::command]
pub async fn reset_auxiliary_models(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<(), DesktopFailure> {
    let _guard = CONFIG_WRITE_LOCK.lock().await;
    let scope = state.resolve_profile(&profile).await?;
    let (body, read_path) = auxiliary_reset_request(&scope.profile)?;
    let operation = uuid::Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("auxiliary_models_reset_start operation={operation} profile={profile}"),
    );
    let result = async {
        let response = config_request_for_scope(
            &state,
            &scope,
            reqwest::Method::POST,
            "/api/model/set",
            Some(body),
        )
        .await?;
        if response.get("ok") != Some(&json!(true)) || response.get("reset") != Some(&json!(true)) {
            return Err(DesktopFailure::operation_failed());
        }
        let readback =
            config_request_for_scope(&state, &scope, reqwest::Method::GET, &read_path, None)
                .await?;
        let tasks = readback
            .get("tasks")
            .and_then(Value::as_array)
            .filter(|tasks| !tasks.is_empty())
            .ok_or_else(DesktopFailure::operation_failed)?;
        if tasks.iter().any(|task| {
            task.get("provider").and_then(Value::as_str) != Some("auto")
                || task.get("model").and_then(Value::as_str) != Some("")
        }) {
            return Err(DesktopFailure::operation_failed());
        }
        Ok(())
    }
    .await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("auxiliary_models_reset_{outcome} operation={operation} profile={profile}"),
    );
    result
}

#[cfg(test)]
#[path = "tests/config.rs"]
mod tests;

#[tauri::command]
pub async fn save_agent_config_field(
    state: State<'_, BackendState>,
    profile: String,
    key: String,
    value: Value,
) -> Result<Value, DesktopFailure> {
    let _guard = CONFIG_WRITE_LOCK.lock().await;
    if key.is_empty()
        || key.len() > 256
        || !key.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    if key == "agent.reasoning_effort" {
        if !value.as_str().is_some_and(|level| {
            matches!(
                level,
                "" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
            )
        }) {
            return Err(DesktopFailure::invalid_input());
        }
    } else {
        let schema = config_request_for_scope(
            &state,
            &scope,
            reqwest::Method::GET,
            "/api/config/schema",
            None,
        )
        .await?;
        if schema
            .pointer(&format!(
                "/fields/{}",
                key.replace('~', "~0").replace('/', "~1")
            ))
            .is_none()
        {
            return Err(DesktopFailure::invalid_input());
        }
    }
    if value.is_object() {
        let current = config_request_for_scope(
            &state,
            &scope,
            reqwest::Method::GET,
            "/api/config/raw",
            None,
        )
        .await?;
        let original = current["yaml"]
            .as_str()
            .ok_or_else(DesktopFailure::operation_failed)?;
        let mut document = if original.trim().is_empty() {
            json!({})
        } else {
            super::config_document::parse_document(original)?
        };
        super::config_document::replace_field(&mut document, &key, value)?;
        let text = serde_yaml::to_string(&document).map_err(|_| DesktopFailure::invalid_input())?;
        let result =
            super::config_document::write_document(&state, &scope, &text, original).await?;
        if result["verified"] != true {
            return Err(DesktopFailure::operation_failed());
        }
        return Ok(json!({"ok":true}));
    }
    let mut patch = value;
    for part in key.split('.').rev() {
        let mut object = serde_json::Map::new();
        object.insert(part.to_owned(), patch);
        patch = Value::Object(object);
    }
    config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::PUT,
        "/api/config",
        Some(json!({"config": patch})),
    )
    .await
}

fn full_config_request(config: Value) -> Result<Value, DesktopFailure> {
    if !config.is_object()
        || serde_json::to_vec(&config)
            .map_err(|_| DesktopFailure::invalid_input())?
            .len()
            > super::config_document::MAX_DOCUMENT_BYTES
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(json!({"config": config}))
}

#[tauri::command]
pub async fn save_agent_config(
    state: State<'_, BackendState>,
    profile: String,
    config: Value,
) -> Result<Value, DesktopFailure> {
    let _guard = CONFIG_WRITE_LOCK.lock().await;
    let body = full_config_request(config.clone())?;
    let scope = state.resolve_profile(&profile).await?;
    let operation = uuid::Uuid::new_v4();
    let log = |stage: &str| {
        let _ = append_client_event(
            &scope.storage,
            &format!("config_document_save_{stage} operation={operation} profile={profile}"),
        );
    };
    log("start");
    let result = async {
        config_request_for_scope(
            &state,
            &scope,
            reqwest::Method::PUT,
            "/api/config",
            Some(body),
        )
        .await?;
        let actual =
            config_request_for_scope(&state, &scope, reqwest::Method::GET, "/api/config", None)
                .await?;
        let defaults = config_request_for_scope(
            &state,
            &scope,
            reqwest::Method::GET,
            "/api/config/defaults",
            None,
        )
        .await?;
        let verified = super::config_document::documents_match(&config, &actual, &defaults);
        Ok(json!({"verified": verified, "config": actual}))
    }
    .await;
    log(if result.is_ok() {
        "completed"
    } else {
        "failed"
    });
    result
}

fn checked_json_path(path: &str) -> Result<PathBuf, DesktopFailure> {
    let path = plain_path(Path::new(path));
    if !path.is_absolute()
        || path
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("json"))
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(path)
}

fn read_config_json(path: &Path) -> Result<Value, DesktopFailure> {
    let canonical = path
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let metadata = fs::metadata(filesystem_path(&canonical))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !metadata.is_file() || metadata.len() > super::config_document::MAX_DOCUMENT_BYTES as u64 {
        return Err(DesktopFailure::invalid_input());
    }
    let bytes =
        fs::read(filesystem_path(&canonical)).map_err(|_| DesktopFailure::operation_failed())?;
    let config: Value =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::invalid_input())?;
    if !config.is_object() {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(config)
}

fn write_config_json(path: &Path, config: &Value) -> Result<(usize, bool), DesktopFailure> {
    let content = serde_json::to_vec_pretty(config).map_err(|_| DesktopFailure::invalid_input())?;
    if content.len() > super::config_document::MAX_DOCUMENT_BYTES {
        return Err(DesktopFailure::invalid_input());
    }
    let temporary = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("hermes-config.json"),
        uuid::Uuid::new_v4(),
    ));
    let temporary_fs = filesystem_path(&temporary);
    let target_fs = filesystem_path(path);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_fs)
        .map_err(|_| DesktopFailure::operation_failed())?;
    let result = (|| {
        file.write_all(&content)
            .map_err(|_| DesktopFailure::operation_failed())?;
        file.sync_all()
            .map_err(|_| DesktopFailure::operation_failed())?;
        drop(file);
        fs::hard_link(&temporary_fs, &target_fs).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                DesktopFailure::conflict()
            } else {
                DesktopFailure::operation_failed()
            }
        })
    })();
    let cleanup_ok = fs::remove_file(&temporary_fs).is_ok();
    result.map(|()| (content.len(), cleanup_ok))
}

#[tauri::command]
pub async fn import_agent_config_json(
    state: State<'_, BackendState>,
    profile: String,
    path: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    scope.ensure_current(&state).await?;
    let operation = uuid::Uuid::new_v4();
    let _ = append_client_event(
        &scope.storage,
        &format!("config_json_import_start operation={operation} profile={profile}"),
    );
    let result = match checked_json_path(&path) {
        Ok(selected) => {
            match tokio::task::spawn_blocking(move || read_config_json(&selected)).await {
                Ok(result) => result,
                Err(_) => Err(DesktopFailure::operation_failed()),
            }
        }
        Err(error) => Err(error),
    };
    let _ = append_client_event(
        &scope.storage,
        &format!(
            "config_json_import_{} operation={operation} profile={profile}",
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            }
        ),
    );
    result
}

#[tauri::command]
pub async fn export_agent_config_json(
    state: State<'_, BackendState>,
    profile: String,
    path: String,
    config: Value,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    scope.ensure_current(&state).await?;
    let operation = uuid::Uuid::new_v4();
    let _ = append_client_event(
        &scope.storage,
        &format!("config_json_export_start operation={operation} profile={profile}"),
    );
    let selected = match checked_json_path(&path) {
        Ok(selected) => selected,
        Err(error) => {
            let _ = append_client_event(
                &scope.storage,
                &format!("config_json_export_failed operation={operation} profile={profile}"),
            );
            return Err(error);
        }
    };
    if let Err(error) = full_config_request(config.clone()) {
        let _ = append_client_event(
            &scope.storage,
            &format!("config_json_export_failed operation={operation} profile={profile}"),
        );
        return Err(error);
    }
    let output = selected.clone();
    let result =
        match tokio::task::spawn_blocking(move || write_config_json(&output, &config)).await {
            Ok(result) => result,
            Err(_) => Err(DesktopFailure::operation_failed()),
        };
    let _ = append_client_event(
        &scope.storage,
        &format!(
            "config_json_export_{} operation={operation} profile={profile}",
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            }
        ),
    );
    result.map(|(bytes, cleanup_ok)| {
        if !cleanup_ok {
            let _ = append_client_event(
                &scope.storage,
                &format!(
                    "config_json_export_cleanup_failed operation={operation} profile={profile}"
                ),
            );
        }
        json!({
            "path": plain_path(&selected).to_string_lossy(),
            "bytes": bytes
        })
    })
}

#[tauri::command]
pub async fn save_agent_config_raw(
    state: State<'_, BackendState>,
    profile: String,
    yaml_text: String,
    expected_yaml: String,
) -> Result<Value, DesktopFailure> {
    let _guard = CONFIG_WRITE_LOCK.lock().await;
    if yaml_text.len() > 256 * 1024 || expected_yaml.len() > 256 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    super::config_document::write_document(&state, &scope, &yaml_text, &expected_yaml).await
}
