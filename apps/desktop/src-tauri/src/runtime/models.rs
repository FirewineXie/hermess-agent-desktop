use super::config::{
    config_request_for_scope, config_request_to_profile, config_request_to_profile_with_limits,
    resolve_config_target,
};
use super::profile_scope::ResolvedProfileScope;
use super::BackendState;
use crate::errors::DesktopFailure;
use crate::storage::product_storage;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSyncTarget {
    profile: String,
    status: &'static str,
    config_copied: bool,
    credential_copied: bool,
    requires_reauthentication: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflict_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    changed_fields: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSyncResult {
    source_profile: String,
    endpoint_id: String,
    targets: Vec<ProviderSyncTarget>,
}

pub(super) fn custom_endpoint_delete_path(endpoint_id: &str) -> Result<String, DesktopFailure> {
    let mut url = reqwest::Url::parse("http://localhost/api/providers/custom-endpoints/")
        .map_err(|_| DesktopFailure::operation_failed())?;
    url.path_segments_mut()
        .map_err(|_| DesktopFailure::operation_failed())?
        .pop_if_empty()
        .push(endpoint_id);
    Ok(url.path().to_owned())
}

async fn model_lists_file(
    state: &State<'_, BackendState>,
    profile: &str,
    storage_path: String,
) -> Result<(ResolvedProfileScope, PathBuf), DesktopFailure> {
    let storage = product_storage(Path::new(&storage_path))?;
    let scope = state.resolve_profile(profile).await?;
    if storage != scope.storage {
        return Err(DesktopFailure::conflict());
    }
    let path = if profile == "default" {
        storage.join("model-candidates.json")
    } else {
        scope.home.join("model-candidates.json")
    };
    Ok((scope, path))
}

#[tauri::command]
pub async fn load_model_lists(
    state: State<'_, BackendState>,
    profile: String,
    storage_path: String,
) -> Result<Option<HashMap<String, Vec<String>>>, DesktopFailure> {
    let (scope, file) = model_lists_file(&state, &profile, storage_path).await?;
    scope.ensure_current(&state).await?;
    let result = read_model_lists_file(&file)?;
    scope.ensure_current(&state).await?;
    Ok(result)
}

pub(super) fn read_model_lists_file(
    file: &Path,
) -> Result<Option<HashMap<String, Vec<String>>>, DesktopFailure> {
    if !file.exists() {
        return Ok(None);
    }
    let bytes = fs::read(file).map_err(|_| "无法读取本机模型候选".to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err(DesktopFailure::operation_failed());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| DesktopFailure::operation_failed())
}

#[tauri::command]
pub async fn save_model_lists(
    state: State<'_, BackendState>,
    profile: String,
    storage_path: String,
    lists: HashMap<String, Vec<String>>,
) -> Result<(), DesktopFailure> {
    let (scope, file) = model_lists_file(&state, &profile, storage_path).await?;
    scope.ensure_current(&state).await?;
    write_model_lists_file(&file, &lists)?;
    scope.ensure_current(&state).await
}

pub(super) fn write_model_lists_file(
    file: &Path,
    lists: &HashMap<String, Vec<String>>,
) -> Result<(), DesktopFailure> {
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
        return Err(DesktopFailure::invalid_input());
    }
    let bytes = serde_json::to_vec(&lists).map_err(|_| "无法编码本机模型候选".to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    fs::write(file, bytes).map_err(|_| DesktopFailure::operation_failed())
}

#[tauri::command]
pub async fn list_model_options(
    state: State<'_, BackendState>,
    profile: String,
    refresh: bool,
    include_unconfigured: Option<bool>,
    session_id: Option<String>,
) -> Result<Value, DesktopFailure> {
    if session_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 256)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.resolve_chat_gateway(&profile).await?;
    let mut params = json!({"include_unconfigured": include_unconfigured.unwrap_or(true),
                            "refresh": refresh});
    if let Some(id) = session_id {
        params["session_id"] = json!(id);
    }
    gateway
        .request("model.options", params)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_auxiliary_models(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    config_request_to_profile_with_limits(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/model/auxiliary",
        None,
        Duration::from_secs(15),
        256 * 1024,
    )
    .await
}

#[tauri::command]
pub async fn select_chat_model(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
    provider: String,
    model: String,
    confirm: Option<String>,
) -> Result<Value, DesktopFailure> {
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
        return Err(DesktopFailure::invalid_input());
    }
    let gateway = state.resolve_chat_gateway(&profile).await?;
    let snapshot = gateway
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
    gateway
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
        .map_err(Into::into)
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
    profile: String,
) -> Result<SavedModelConfig, DesktopFailure> {
    if state.3.lock().await.is_some() {
        let value = config_request_to_profile_with_limits(
            &state,
            &profile,
            reqwest::Method::GET,
            "/api/config/raw",
            None,
            Duration::from_secs(15),
            256 * 1024,
        )
        .await?;
        let yaml = value
            .get("yaml")
            .and_then(Value::as_str)
            .filter(|text| text.len() <= 256 * 1024)
            .ok_or_else(DesktopFailure::operation_failed)?;
        return parse_saved_model_config(yaml).map_err(Into::into);
    }
    let scope = state.resolve_profile(&profile).await?;
    scope.ensure_current(&state).await?;
    let (port, auth_header, token) = scope.http_auth().await?;
    scope.ensure_current(&state).await?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法建立本地配置连接".to_string())?;
    let mut response = client
        .get(format!("http://127.0.0.1:{port}/api/config/raw"))
        .header(auth_header, token)
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
    scope.ensure_current(&state).await?;
    let yaml = value
        .get("yaml")
        .and_then(Value::as_str)
        .ok_or("模型配置响应缺少内容")?;
    parse_saved_model_config(yaml).map_err(Into::into)
}

#[tauri::command]
pub async fn list_custom_endpoints(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/providers/custom-endpoints",
        None,
    )
    .await
}

#[tauri::command]
pub async fn add_custom_endpoint(
    state: State<'_, BackendState>,
    profile: String,
    name: String,
    base_url: String,
    model: String,
    api_key: String,
    make_default: bool,
    discover_models: bool,
) -> Result<Value, DesktopFailure> {
    let name = name.trim();
    let base_url = base_url.trim();
    let model = model.trim();
    validate_custom_endpoint_fields(name, base_url, model, Some(&api_key))?;
    let mut body = json!({"id": format!("desktop-{}", Uuid::new_v4().simple()),
        "name": name, "base_url": base_url, "model": model, "make_default": make_default,
        "discover_models": discover_models});
    if !api_key.is_empty() {
        body["api_key"] = json!(api_key);
    }
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::POST,
        "/api/providers/custom-endpoints",
        Some(body),
    )
    .await
}

fn validate_custom_endpoint_fields(
    name: &str,
    base_url: &str,
    model: &str,
    api_key: Option<&String>,
) -> Result<(), DesktopFailure> {
    if name.is_empty()
        || name.len() > 128
        || model.is_empty()
        || model.len() > 256
        || model.chars().any(char::is_whitespace)
        || api_key.is_some_and(|key| key.len() > 4096)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let parsed = reqwest::Url::parse(base_url).map_err(|_| DesktopFailure::invalid_input())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(())
}

#[tauri::command]
pub async fn update_custom_endpoint(
    state: State<'_, BackendState>,
    profile: String,
    endpoint_id: String,
    name: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    make_default: bool,
    discover_models: bool,
) -> Result<Value, DesktopFailure> {
    let endpoint_id = endpoint_id.trim();
    let name = name.trim();
    let base_url = base_url.trim();
    let model = model.trim();
    if endpoint_id.is_empty()
        || endpoint_id.len() > 128
        || endpoint_id.chars().any(char::is_control)
    {
        return Err(DesktopFailure::invalid_input());
    }
    validate_custom_endpoint_fields(name, base_url, model, api_key.as_ref())?;
    let target = resolve_config_target(&state, &profile).await?;
    let listed = target
        .request(
            &state,
            reqwest::Method::GET,
            "/api/providers/custom-endpoints",
            None,
        )
        .await?;
    let exists = listed
        .get("endpoints")
        .and_then(Value::as_array)
        .is_some_and(|endpoints| {
            endpoints.iter().any(|endpoint| {
                endpoint.get("id").and_then(Value::as_str) == Some(endpoint_id)
                    && endpoint.get("source").and_then(Value::as_str) != Some("direct-config")
            })
        });
    if !exists {
        return Err(DesktopFailure::conflict());
    }
    let mut body = json!({"id": endpoint_id, "name": name, "base_url": base_url,
        "model": model, "make_default": make_default, "discover_models": discover_models});
    if let Some(key) = api_key {
        body["api_key"] = json!(key);
    }
    target
        .request(
            &state,
            reqwest::Method::POST,
            "/api/providers/custom-endpoints",
            Some(body),
        )
        .await
}

#[tauri::command]
pub async fn set_custom_endpoint_discovery(
    state: State<'_, BackendState>,
    profile: String,
    endpoint_id: String,
    discover_models: bool,
) -> Result<Value, DesktopFailure> {
    if endpoint_id.is_empty()
        || endpoint_id.len() > 128
        || endpoint_id.chars().any(char::is_control)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let target = resolve_config_target(&state, &profile).await?;
    let listed = target
        .request(
            &state,
            reqwest::Method::GET,
            "/api/providers/custom-endpoints",
            None,
        )
        .await?;
    let endpoint = listed
        .get("endpoints")
        .and_then(Value::as_array)
        .and_then(|endpoints| {
            endpoints.iter().find(|endpoint| {
                endpoint.get("id").and_then(Value::as_str) == Some(endpoint_id.as_str())
            })
        })
        .ok_or_else(DesktopFailure::conflict)?;
    if endpoint.get("source").and_then(Value::as_str) == Some("direct-config") {
        return Err(DesktopFailure::invalid_input());
    }
    let field = |key| {
        endpoint
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
    };
    let name = field("name");
    let base_url = field("base_url");
    let model = field("model");
    if name.is_empty() || base_url.is_empty() || model.is_empty() {
        return Err(DesktopFailure::invalid_input());
    }
    target
        .request(
            &state,
            reqwest::Method::POST,
            "/api/providers/custom-endpoints",
            Some(
                json!({"id": endpoint_id, "name": name, "base_url": base_url,
            "model": model, "discover_models": discover_models, "make_default": false}),
            ),
        )
        .await
}

#[tauri::command]
pub async fn delete_custom_endpoint(
    state: State<'_, BackendState>,
    profile: String,
    endpoint_id: String,
) -> Result<Value, DesktopFailure> {
    if endpoint_id.is_empty()
        || endpoint_id.len() > 128
        || endpoint_id.chars().any(char::is_control)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let target = resolve_config_target(&state, &profile).await?;
    let listed = target
        .request(
            &state,
            reqwest::Method::GET,
            "/api/providers/custom-endpoints",
            None,
        )
        .await?;
    let source = listed
        .get("endpoints")
        .and_then(Value::as_array)
        .and_then(|endpoints| {
            endpoints.iter().find_map(|endpoint| {
                (endpoint.get("id").and_then(Value::as_str) == Some(endpoint_id.as_str()))
                    .then(|| endpoint.get("source").and_then(Value::as_str))
                    .flatten()
            })
        });
    let Some(source) = source else {
        return Err(DesktopFailure::conflict());
    };
    if source == "direct-config" {
        return target
            .request(
                &state,
                reqwest::Method::PUT,
                "/api/config",
                Some(json!({
                    "profile": profile,
                    "config": {"model": {
                        "default": "", "model": "", "name": "", "provider": "",
                        "base_url": "", "api_base": "", "api": "", "api_key": "",
                        "key_env": "", "api_key_env": "", "api_mode": ""
                    }}
                })),
            )
            .await;
    }
    let path = custom_endpoint_delete_path(&endpoint_id)?;
    target
        .request(&state, reqwest::Method::DELETE, &path, None)
        .await
}

mod provider_sync;
pub(super) use provider_sync::{
    provider_sync_conflict, provider_sync_difference_fields, provider_sync_model_details,
    provider_sync_template, provider_sync_verified,
};

#[tauri::command]
pub async fn sync_model_provider(
    state: State<'_, BackendState>,
    profile: String,
    endpoint_id: String,
    target_profiles: Vec<String>,
    apply: bool,
    replace_conflicts: bool,
) -> Result<ProviderSyncResult, DesktopFailure> {
    if profile.is_empty()
        || endpoint_id.is_empty()
        || endpoint_id.len() > 128
        || target_profiles.is_empty()
        || target_profiles.len() > 32
        || target_profiles.iter().any(|target| {
            target.is_empty()
                || target == &profile
                || target.len() > 128
                || target.chars().any(char::is_control)
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut targets = target_profiles;
    targets.sort();
    targets.dedup();
    let source_scope = state.resolve_profile(&profile).await?;
    let listed = config_request_for_scope(
        &state,
        &source_scope,
        reqwest::Method::GET,
        "/api/providers/custom-endpoints",
        None,
    )
    .await?;
    let source = listed
        .get("endpoints")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(endpoint_id.as_str()))
        })
        .cloned()
        .ok_or_else(DesktopFailure::conflict)?;
    let mut copy_template = provider_sync_template(&source)?;
    let source_config = config_request_for_scope(
        &state,
        &source_scope,
        reqwest::Method::GET,
        "/api/config?include_defaults=false",
        None,
    )
    .await?;
    let model_details =
        provider_sync_model_details(&source_config, &endpoint_id, &copy_template["models"]);
    if !model_details.is_empty() {
        copy_template["model_details"] = json!(model_details);
    }
    let name = copy_template["name"].as_str().unwrap_or_default();
    let base_url = copy_template["base_url"].as_str().unwrap_or_default();
    let mut results = Vec::with_capacity(targets.len());
    for target_profile in targets {
        let target_scope = state.resolve_profile(&target_profile).await?;
        let target_list = config_request_for_scope(
            &state,
            &target_scope,
            reqwest::Method::GET,
            "/api/providers/custom-endpoints",
            None,
        )
        .await?;
        let conflict = provider_sync_conflict(&target_list, &endpoint_id, name, base_url);
        let different_name_same_url = conflict.is_some_and(|(existing, kind)| {
            kind == "address" && existing.get("name").and_then(Value::as_str) != Some(name)
        });
        if !apply || (conflict.is_some() && (!replace_conflicts || different_name_same_url)) {
            results.push(ProviderSyncTarget {
                profile: target_profile,
                status: if conflict.is_some() {
                    "conflict"
                } else {
                    "ready"
                },
                config_copied: false,
                credential_copied: false,
                requires_reauthentication: true,
                conflict_kind: conflict.map(|(_, kind)| kind),
                changed_fields: conflict
                    .map(|(existing, _)| provider_sync_difference_fields(existing, &copy_template))
                    .unwrap_or_default(),
            });
            continue;
        }
        let target_id = match conflict.map(|(existing, _)| existing) {
            Some(existing)
                if existing.get("source").and_then(Value::as_str) == Some("direct-config") =>
            {
                results.push(ProviderSyncTarget {
                    profile: target_profile,
                    status: "failed",
                    config_copied: false,
                    credential_copied: false,
                    requires_reauthentication: true,
                    conflict_kind: conflict.map(|(_, kind)| kind),
                    changed_fields: conflict
                        .map(|(existing, _)| {
                            provider_sync_difference_fields(existing, &copy_template)
                        })
                        .unwrap_or_default(),
                });
                continue;
            }
            Some(existing) => existing
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            None => format!("desktop-{}", Uuid::new_v4().simple()),
        };
        let mut copy_body = copy_template.clone();
        copy_body["id"] = json!(target_id);
        let write_result = config_request_for_scope(
            &state,
            &target_scope,
            reqwest::Method::POST,
            "/api/providers/custom-endpoints",
            Some(copy_body),
        )
        .await;
        let status = match write_result {
            Ok(response) if response.get("ok").and_then(Value::as_bool) == Some(true) => {
                match config_request_for_scope(
                    &state,
                    &target_scope,
                    reqwest::Method::GET,
                    "/api/providers/custom-endpoints",
                    None,
                )
                .await
                {
                    Ok(readback)
                        if provider_sync_verified(&readback, &target_id, &copy_template) =>
                    {
                        if model_details.is_empty() {
                            "copied"
                        } else {
                            match config_request_for_scope(
                                &state,
                                &target_scope,
                                reqwest::Method::GET,
                                "/api/config?include_defaults=false",
                                None,
                            )
                            .await
                            {
                                Ok(config)
                                    if provider_sync_model_details(
                                        &config,
                                        &target_id,
                                        &copy_template["models"],
                                    ) == model_details =>
                                {
                                    "copied"
                                }
                                _ => "unverified",
                            }
                        }
                    }
                    _ => "unverified",
                }
            }
            _ => "failed",
        };
        results.push(ProviderSyncTarget {
            profile: target_profile,
            status,
            config_copied: status == "copied",
            // The locked runtime does not expose an export-safe credential copy API.
            credential_copied: false,
            requires_reauthentication: true,
            conflict_kind: conflict.map(|(_, kind)| kind),
            changed_fields: conflict
                .map(|(existing, _)| provider_sync_difference_fields(existing, &copy_template))
                .unwrap_or_default(),
        });
    }
    Ok(ProviderSyncResult {
        source_profile: profile,
        endpoint_id,
        targets: results,
    })
}

#[tauri::command]
pub async fn get_moa_config(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/model/moa",
        None,
    )
    .await
}

#[tauri::command]
pub async fn save_moa_config(
    state: State<'_, BackendState>,
    profile: String,
    config: Value,
) -> Result<Value, DesktopFailure> {
    let encoded = serde_json::to_vec(&config).map_err(|_| DesktopFailure::invalid_input())?;
    if encoded.len() > 512 * 1024
        || !config.get("presets").is_some_and(Value::is_object)
        || !config.get("default_preset").is_some_and(Value::is_string)
        || !config.get("active_preset").is_some_and(Value::is_string)
    {
        return Err(DesktopFailure::invalid_input());
    }
    config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::PUT,
        "/api/model/moa",
        Some(config),
    )
    .await
}

#[tauri::command]
pub async fn check_model_runtime(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let gateway = state.resolve_chat_gateway(&profile).await?;
    gateway
        .request("setup.runtime_check", json!({}))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn set_default_model(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
    model: String,
    base_url: String,
    api_key: String,
    confirm_expensive_model: bool,
) -> Result<Value, DesktopFailure> {
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
        return Err(DesktopFailure::invalid_input());
    }
    if !base_url.is_empty() {
        let parsed = reqwest::Url::parse(base_url).map_err(|_| DesktopFailure::invalid_input())?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.fragment().is_some()
        {
            return Err(DesktopFailure::invalid_input());
        }
    }
    if state.3.lock().await.is_some() {
        return config_request_to_profile_with_limits(
            &state,
            &profile,
            reqwest::Method::POST,
            "/api/model/set",
            Some(json!({
                "scope": "main", "provider": provider, "model": model,
                "base_url": base_url, "api_key": api_key,
                "confirm_expensive_model": confirm_expensive_model,
            })),
            Duration::from_secs(45),
            64 * 1024,
        )
        .await;
    }
    let scope = state.resolve_profile(&profile).await?;
    scope.ensure_current(&state).await?;
    let (port, auth_header, token) = scope.http_auth().await?;
    scope.ensure_current(&state).await?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "无法建立本地配置连接".to_string())?;
    let mut response = client
        .post(format!("http://127.0.0.1:{port}/api/model/set"))
        .header(auth_header, token)
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
        return Err(DesktopFailure::operation_failed());
    }
    scope.ensure_current(&state).await?;
    Ok(value)
}
