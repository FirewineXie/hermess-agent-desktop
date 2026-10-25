use super::BackendState;
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

pub(super) async fn config_request(
    state: &State<'_, BackendState>,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    let (port, token) = state.local_endpoint().await?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法建立本地配置连接".to_string())?;
    let mut request = client
        .request(method, format!("http://127.0.0.1:{port}{path}"))
        .header("X-Hermes-Session-Token", token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "配置请求失败".to_string())?;
    const LIMIT: usize = 2 * 1024 * 1024;
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
        // 上游错误可能包含用户配置或凭据，不向界面透传正文。
        return Err(DesktopFailure::operation_failed());
    }
    Ok(value)
}

#[tauri::command]
pub async fn get_agent_config(state: State<'_, BackendState>) -> Result<Value, DesktopFailure> {
    config_request(&state, reqwest::Method::GET, "/api/config", None).await
}

#[tauri::command]
pub async fn get_agent_config_schema(
    state: State<'_, BackendState>,
) -> Result<Value, DesktopFailure> {
    config_request(&state, reqwest::Method::GET, "/api/config/schema", None).await
}

#[tauri::command]
pub async fn get_agent_config_raw(state: State<'_, BackendState>) -> Result<Value, DesktopFailure> {
    config_request(&state, reqwest::Method::GET, "/api/config/raw", None).await
}

#[tauri::command]
pub async fn save_auxiliary_route(
    state: State<'_, BackendState>,
    task: String,
    provider: String,
    model: String,
    effort: String,
    timeout: Option<f64>,
) -> Result<Value, DesktopFailure> {
    if task.is_empty()
        || task.len() > 80
        || !task.bytes().all(|c| c.is_ascii_lowercase() || c == b'_')
        || provider.len() > 128
        || model.len() > 256
        || ![
            "", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
        ]
        .contains(&effort.as_str())
        || timeout.is_some_and(|value| !value.is_finite() || value <= 0.0)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let schema = config_request(&state, reqwest::Method::GET, "/api/config/schema", None).await?;
    if schema
        .pointer(&format!("/fields/auxiliary.{task}.provider"))
        .is_none()
    {
        return Err(DesktopFailure::invalid_input());
    }
    let provider = provider.trim();
    let model = model.trim();
    if provider.is_empty() || (provider != "auto" && model.is_empty()) {
        return Err(DesktopFailure::invalid_input());
    }
    // A single config PUT prevents an old per-task endpoint or credential from
    // silently overriding the selected named provider.
    let mut auxiliary = serde_json::Map::new();
    let mut route = json!({
        "provider": provider, "model": model,
        "base_url": null, "api_key": null, "key_env": null,
        "api_key_env": null, "api_mode": null
    });
    if schema
        .pointer(&format!("/fields/auxiliary.{task}.reasoning_effort"))
        .is_some()
    {
        route["reasoning_effort"] = json!(effort);
    }
    if let Some(value) = timeout {
        if schema
            .pointer(&format!("/fields/auxiliary.{task}.timeout"))
            .is_some()
        {
            route["timeout"] = json!(value);
        }
    }
    auxiliary.insert(task, route);
    config_request(
        &state,
        reqwest::Method::PUT,
        "/api/config",
        Some(json!({"config": {"auxiliary": auxiliary}})),
    )
    .await
}

#[tauri::command]
pub async fn save_agent_config_field(
    state: State<'_, BackendState>,
    key: String,
    value: Value,
) -> Result<Value, DesktopFailure> {
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
        let schema =
            config_request(&state, reqwest::Method::GET, "/api/config/schema", None).await?;
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
    let mut patch = value;
    for part in key.split('.').rev() {
        let mut object = serde_json::Map::new();
        object.insert(part.to_owned(), patch);
        patch = Value::Object(object);
    }
    config_request(
        &state,
        reqwest::Method::PUT,
        "/api/config",
        Some(json!({"config": patch})),
    )
    .await
}

#[tauri::command]
pub async fn save_agent_config_raw(
    state: State<'_, BackendState>,
    yaml_text: String,
    expected_yaml: String,
) -> Result<Value, DesktopFailure> {
    if yaml_text.len() > 256 * 1024 || expected_yaml.len() > 256 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let current = config_request(&state, reqwest::Method::GET, "/api/config/raw", None).await?;
    if current.get("yaml").and_then(Value::as_str) != Some(expected_yaml.as_str()) {
        return Err(DesktopFailure::conflict());
    }
    config_request(
        &state,
        reqwest::Method::PUT,
        "/api/config/raw",
        Some(json!({"yaml_text": yaml_text})),
    )
    .await
}
