use super::BackendState;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

pub(super) async fn config_request(
    state: &State<'_, BackendState>,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法建立本地配置连接".to_string())?;
    let mut request = client
        .request(method, format!("http://127.0.0.1:{}{path}", backend.port))
        .header("X-Hermes-Session-Token", &backend.token);
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
        return Err("配置响应过大".into());
    }
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取配置响应失败".to_string())?
    {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("配置响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "配置响应不是有效 JSON".to_string())?;
    if !status.is_success() {
        // 上游错误可能包含用户配置或凭据，不向界面透传正文。
        return Err(format!("后端配置请求失败（HTTP {status}）"));
    }
    Ok(value)
}

#[tauri::command]
pub async fn get_agent_config(state: State<'_, BackendState>) -> Result<Value, String> {
    config_request(&state, reqwest::Method::GET, "/api/config", None).await
}

#[tauri::command]
pub async fn get_agent_config_schema(state: State<'_, BackendState>) -> Result<Value, String> {
    config_request(&state, reqwest::Method::GET, "/api/config/schema", None).await
}

#[tauri::command]
pub async fn get_agent_config_raw(state: State<'_, BackendState>) -> Result<Value, String> {
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
) -> Result<Value, String> {
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
        return Err("辅助模型配置无效".into());
    }
    let schema = config_request(&state, reqwest::Method::GET, "/api/config/schema", None).await?;
    if schema
        .pointer(&format!("/fields/auxiliary.{task}.provider"))
        .is_none()
    {
        return Err("辅助模型任务不在当前运行时配置中".into());
    }
    let provider = provider.trim();
    let model = model.trim();
    if provider.is_empty() || (provider != "auto" && model.is_empty()) {
        return Err("请选择提供商和模型".into());
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
) -> Result<Value, String> {
    if key.is_empty()
        || key.len() > 256
        || !key.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        })
    {
        return Err("配置字段无效".into());
    }
    let schema = config_request(&state, reqwest::Method::GET, "/api/config/schema", None).await?;
    if schema
        .pointer(&format!(
            "/fields/{}",
            key.replace('~', "~0").replace('/', "~1")
        ))
        .is_none()
    {
        return Err("配置字段不在当前上游 schema 中".into());
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
) -> Result<Value, String> {
    if yaml_text.len() > 256 * 1024 || expected_yaml.len() > 256 * 1024 {
        return Err("配置内容过大".into());
    }
    let current = config_request(&state, reqwest::Method::GET, "/api/config/raw", None).await?;
    if current.get("yaml").and_then(Value::as_str) != Some(expected_yaml.as_str()) {
        return Err("配置文件已被其他操作修改，请重新读取后再保存".into());
    }
    config_request(
        &state,
        reqwest::Method::PUT,
        "/api/config/raw",
        Some(json!({"yaml_text": yaml_text})),
    )
    .await
}
