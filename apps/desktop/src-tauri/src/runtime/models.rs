use super::config::config_request;
use super::BackendState;
use crate::storage::product_storage;
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashMap, fs, path::Path, time::Duration};
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn load_model_lists(
    storage_path: String,
) -> Result<Option<HashMap<String, Vec<String>>>, String> {
    let file = product_storage(Path::new(&storage_path))?.join("model-candidates.json");
    if !file.exists() {
        return Ok(None);
    }
    let bytes = fs::read(file).map_err(|_| "无法读取本机模型候选".to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("本机模型候选文件过大".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "本机模型候选文件格式无效".to_string())
}

#[tauri::command]
pub fn save_model_lists(
    storage_path: String,
    lists: HashMap<String, Vec<String>>,
) -> Result<(), String> {
    if lists.len() > 256
        || lists.iter().any(|(provider, models)| {
            provider.is_empty()
                || provider.len() > 256
                || models.len() > 2048
                || models.iter().any(|model| {
                    model.trim().is_empty()
                        || model.len() > 256
                        || model.chars().any(char::is_whitespace)
                })
        })
    {
        return Err("本机模型候选无效".into());
    }
    let bytes = serde_json::to_vec(&lists).map_err(|_| "无法编码本机模型候选".to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("本机模型候选文件过大".into());
    }
    let file = product_storage(Path::new(&storage_path))?.join("model-candidates.json");
    fs::write(file, bytes).map_err(|_| "无法保存本机模型候选".to_string())
}

#[tauri::command]
pub async fn list_model_options(
    state: State<'_, BackendState>,
    refresh: bool,
    include_unconfigured: Option<bool>,
    session_id: Option<String>,
) -> Result<Value, String> {
    if session_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 256)
    {
        return Err("会话 ID 无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let mut params = json!({"include_unconfigured": include_unconfigured.unwrap_or(true),
                            "refresh": refresh});
    if let Some(id) = session_id {
        params["session_id"] = json!(id);
    }
    backend.gateway.request("model.options", params).await
}

#[tauri::command]
pub async fn select_chat_model(
    state: State<'_, BackendState>,
    session_id: String,
    provider: String,
    model: String,
    confirm: Option<String>,
) -> Result<Value, String> {
    let provider = provider.trim();
    let model = model.trim();
    if session_id.is_empty()
        || session_id.len() > 256
        || provider.is_empty()
        || provider.len() > 128
        || provider.chars().any(char::is_whitespace)
        || model.is_empty()
        || model.len() > 256
        || model.chars().any(char::is_whitespace)
    {
        return Err("会话模型选择无效".into());
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let snapshot = backend
        .gateway
        .request("session.resume", json!({"session_id": session_id}))
        .await?;
    let revision = snapshot
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or("会话缺少修订版本")?;
    let generation = snapshot
        .get("execution_generation")
        .and_then(Value::as_u64)
        .ok_or("会话缺少运行代次")?;
    let mut payload = json!({"provider": provider, "model": model});
    if let Some(token) = confirm.filter(|value| !value.is_empty() && value.len() <= 256) {
        payload["confirm"] = json!(token);
    }
    backend
        .gateway
        .request(
            "session.mutate",
            json!({
                "session_id": session_id,
                "request_id": Uuid::new_v4().to_string(),
                "expected_revision": revision,
                "expected_generation": generation,
                "operation": "model",
                "payload": payload,
            }),
        )
        .await
}

#[derive(Debug, PartialEq, Serialize)]
pub struct SavedModelConfig {
    pub(super) provider: String,
    pub(super) model: String,
    pub(super) base_url: String,
}

pub(super) fn parse_saved_model_config(yaml: &str) -> Result<SavedModelConfig, String> {
    let config: serde_yaml::Value =
        serde_yaml::from_str(yaml).map_err(|_| "模型配置格式无法解析".to_string())?;
    let model = config.get("model");
    let field = |name| {
        model
            .and_then(|value| value.get(name))
            .and_then(serde_yaml::Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned()
    };
    Ok(SavedModelConfig {
        provider: field("provider"),
        model: model
            .and_then(serde_yaml::Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| {
                let default = field("default");
                if default.is_empty() {
                    field("name")
                } else {
                    default
                }
            }),
        base_url: field("base_url"),
    })
}

#[tauri::command]
pub async fn get_saved_model_config(
    state: State<'_, BackendState>,
) -> Result<SavedModelConfig, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法建立本地配置连接".to_string())?;
    let mut response = client
        .get(format!("http://127.0.0.1:{}/api/config/raw", backend.port))
        .header("X-Hermes-Session-Token", &backend.token)
        .send()
        .await
        .map_err(|_| "读取本地模型配置失败".to_string())?;
    if !response.status().is_success() {
        return Err("后端拒绝读取模型配置".into());
    }
    const MAX_CONFIG_BYTES: usize = 256 * 1024;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_CONFIG_BYTES as u64)
    {
        return Err("模型配置响应过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取模型配置响应失败".to_string())?
    {
        if bytes.len() + chunk.len() > MAX_CONFIG_BYTES {
            return Err("模型配置响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "模型配置响应无效".to_string())?;
    let yaml = value
        .get("yaml")
        .and_then(Value::as_str)
        .ok_or("模型配置响应缺少内容")?;
    parse_saved_model_config(yaml)
}

#[tauri::command]
pub async fn list_custom_endpoints(state: State<'_, BackendState>) -> Result<Value, String> {
    config_request(
        &state,
        reqwest::Method::GET,
        "/api/providers/custom-endpoints",
        None,
    )
    .await
}

#[tauri::command]
pub async fn add_custom_endpoint(
    state: State<'_, BackendState>,
    name: String,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<Value, String> {
    let name = name.trim();
    let base_url = base_url.trim();
    let model = model.trim();
    if name.is_empty()
        || name.len() > 128
        || model.is_empty()
        || model.len() > 256
        || model.chars().any(char::is_whitespace)
        || api_key.len() > 4096
    {
        return Err("提供商名称、模型 ID 或密钥无效".into());
    }
    let parsed = reqwest::Url::parse(base_url).map_err(|_| "模型接口地址无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err("模型接口必须是无内嵌凭据的 HTTP 或 HTTPS 地址".into());
    }
    let mut body = json!({"id": format!("desktop-{}", Uuid::new_v4().simple()),
        "name": name, "base_url": base_url, "model": model, "make_default": false});
    if !api_key.is_empty() {
        body["api_key"] = json!(api_key);
    }
    config_request(
        &state,
        reqwest::Method::POST,
        "/api/providers/custom-endpoints",
        Some(body),
    )
    .await
}

#[tauri::command]
pub async fn delete_custom_endpoint(
    state: State<'_, BackendState>,
    endpoint_id: String,
) -> Result<Value, String> {
    if endpoint_id.is_empty()
        || endpoint_id.len() > 128
        || endpoint_id.chars().any(char::is_control)
    {
        return Err("提供商标识无效".into());
    }
    let listed = config_request(
        &state,
        reqwest::Method::GET,
        "/api/providers/custom-endpoints",
        None,
    )
    .await?;
    let removable = listed
        .get("endpoints")
        .and_then(Value::as_array)
        .is_some_and(|endpoints| {
            endpoints.iter().any(|endpoint| {
                endpoint.get("id").and_then(Value::as_str) == Some(endpoint_id.as_str())
                    && endpoint.get("source").and_then(Value::as_str) != Some("direct-config")
            })
        });
    if !removable {
        return Err("只能删除已保存的自定义提供商".into());
    }
    let mut url = reqwest::Url::parse("http://localhost/api/providers/custom-endpoints/")
        .map_err(|_| "无法构建提供商地址".to_string())?;
    url.path_segments_mut()
        .map_err(|_| "无法构建提供商地址".to_string())?
        .push(&endpoint_id);
    config_request(&state, reqwest::Method::DELETE, url.path(), None).await
}

#[tauri::command]
pub async fn check_model_runtime(state: State<'_, BackendState>) -> Result<Value, String> {
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    backend
        .gateway
        .request("setup.runtime_check", json!({}))
        .await
}

#[tauri::command]
pub async fn set_default_model(
    state: State<'_, BackendState>,
    provider: String,
    model: String,
    base_url: String,
    api_key: String,
    confirm_expensive_model: bool,
) -> Result<Value, String> {
    let provider = provider.trim();
    let model = model.trim();
    let base_url = base_url.trim();
    if provider.is_empty()
        || provider.len() > 128
        || model.is_empty()
        || model.len() > 256
        || base_url.len() > 2048
        || api_key.len() > 4096
    {
        return Err("模型配置字段为空或过长".into());
    }
    if !base_url.is_empty() {
        let parsed = reqwest::Url::parse(base_url).map_err(|_| "模型接口地址无效".to_string())?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.fragment().is_some()
        {
            return Err("模型接口必须是无内嵌凭据的 HTTP 或 HTTPS 地址".into());
        }
    }
    let owned = state.0.lock().await;
    let backend = owned.as_ref().ok_or("后端尚未启动")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "无法建立本地配置连接".to_string())?;
    let mut response = client
        .post(format!("http://127.0.0.1:{}/api/model/set", backend.port))
        .header("X-Hermes-Session-Token", &backend.token)
        .json(&json!({
            "scope": "main", "provider": provider, "model": model,
            "base_url": base_url, "api_key": api_key,
            "confirm_expensive_model": confirm_expensive_model,
        }))
        .send()
        .await
        .map_err(|_| "本地模型配置请求失败".to_string())?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|size| size > 64 * 1024)
    {
        return Err("模型配置响应过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取模型配置响应失败".to_string())?
    {
        if bytes.len() + chunk.len() > 64 * 1024 {
            return Err("模型配置响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| format!("模型配置返回无效 JSON（HTTP {status}）"))?;
    if !status.is_success() {
        let detail = value
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or("模型配置失败");
        let safe = if api_key.is_empty() {
            detail.to_owned()
        } else {
            detail.replace(&api_key, "[已隐藏]")
        };
        return Err(format!(
            "模型配置失败（HTTP {status}）：{}",
            safe.chars().take(400).collect::<String>()
        ));
    }
    Ok(value)
}
