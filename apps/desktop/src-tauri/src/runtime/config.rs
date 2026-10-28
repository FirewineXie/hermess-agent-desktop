use super::{
    profile_scope::{valid_profile_name, ResolvedProfileScope},
    profiles, remote_connections, BackendState,
};
use crate::errors::DesktopFailure;
use crate::gateway::GatewayClient;
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use tauri::State;

pub(super) enum ConfigTarget {
    Local(ResolvedProfileScope),
    Remote {
        profile: String,
        connection_id: String,
        gateway: Arc<GatewayClient>,
        base_url: String,
        token: String,
    },
}

impl ConfigTarget {
    pub(super) async fn request(
        &self,
        state: &State<'_, BackendState>,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, DesktopFailure> {
        self.request_with_limits(
            state,
            method,
            path,
            body,
            Duration::from_secs(20),
            2 * 1024 * 1024,
        )
        .await
    }

    async fn request_with_limits(
        &self,
        state: &State<'_, BackendState>,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
        timeout: Duration,
        limit: usize,
    ) -> Result<Value, DesktopFailure> {
        match self {
            Self::Local(scope) => {
                config_request_for_scope_with_limits(
                    state, scope, method, path, body, timeout, limit,
                )
                .await
            }
            Self::Remote {
                profile,
                gateway,
                base_url,
                token,
                ..
            } => {
                self.ensure_current(state).await?;
                let url = remote_request_url(base_url, path, profile)?;
                let result = request_url_with_auth(
                    method,
                    url,
                    body,
                    "X-Hermes-Session-Token",
                    token.clone(),
                    timeout,
                    limit,
                    false,
                )
                .await?;
                if gateway.is_closed() {
                    return Err(DesktopFailure::connection_lost());
                }
                self.ensure_current(state).await?;
                Ok(result)
            }
        }
    }

    pub(super) async fn ensure_current(
        &self,
        state: &State<'_, BackendState>,
    ) -> Result<(), DesktopFailure> {
        match self {
            Self::Local(scope) => scope.ensure_current(state).await,
            Self::Remote {
                connection_id,
                gateway,
                ..
            } => {
                let active = state.3.lock().await;
                if active.as_ref().is_some_and(|current| {
                    current.connection_id == *connection_id
                        && Arc::ptr_eq(&current.gateway, gateway)
                }) {
                    Ok(())
                } else {
                    Err(DesktopFailure::conflict())
                }
            }
        }
    }
}

pub(super) async fn resolve_config_target(
    state: &State<'_, BackendState>,
    profile: &str,
) -> Result<ConfigTarget, DesktopFailure> {
    if !valid_profile_name(profile) {
        return Err(DesktopFailure::invalid_input());
    }
    let remote = state.3.lock().await;
    if let Some(active) = remote.as_ref() {
        if !profiles::roster_contains(&active.roster, profile) || active.gateway.is_closed() {
            return Err(DesktopFailure::conflict());
        }
        return Ok(ConfigTarget::Remote {
            profile: profile.to_owned(),
            connection_id: active.connection_id.clone(),
            gateway: Arc::clone(&active.gateway),
            base_url: active.base_url.clone(),
            token: active.token.clone(),
        });
    }
    drop(remote);
    Ok(ConfigTarget::Local(state.resolve_profile(profile).await?))
}

pub(super) async fn config_request_to_profile(
    state: &State<'_, BackendState>,
    profile: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    resolve_config_target(state, profile)
        .await?
        .request(state, method, path, body)
        .await
}

pub(super) async fn config_request_to_profile_with_limits(
    state: &State<'_, BackendState>,
    profile: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    timeout: Duration,
    limit: usize,
) -> Result<Value, DesktopFailure> {
    resolve_config_target(state, profile)
        .await?
        .request_with_limits(state, method, path, body, timeout, limit)
        .await
}

fn remote_request_url(
    base_url: &str,
    path: &str,
    profile: &str,
) -> Result<reqwest::Url, DesktopFailure> {
    if !path.starts_with("/api/")
        || path.contains('#')
        || path.contains('\\')
        || path.contains("..")
        || !valid_profile_name(profile)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let base = remote_connections::normalized_remote_url(base_url)?;
    let mut url = reqwest::Url::parse(&format!("{}{path}", base.as_str().trim_end_matches('/')))
        .map_err(|_| DesktopFailure::invalid_input())?;
    let expected_prefix = format!("{}/api/", base.path().trim_end_matches('/'));
    if !url.path().starts_with(&expected_prefix) {
        return Err(DesktopFailure::invalid_input());
    }
    let scoped: Vec<String> = url
        .query_pairs()
        .filter(|(key, _)| key == "profile")
        .map(|(_, value)| value.into_owned())
        .collect();
    if scoped.len() > 1 || scoped.first().is_some_and(|name| name != profile) {
        return Err(DesktopFailure::conflict());
    }
    if scoped.is_empty() {
        url.query_pairs_mut().append_pair("profile", profile);
    }
    Ok(url)
}

pub(super) async fn config_request_for_scope(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    config_request_for_scope_with_limits(
        state,
        scope,
        method,
        path,
        body,
        Duration::from_secs(20),
        2 * 1024 * 1024,
    )
    .await
}

pub(super) async fn config_request_for_scope_with_limits(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    timeout: Duration,
    limit: usize,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let (port, auth_header, token) = scope.http_auth().await?;
    scope.ensure_current(state).await?;
    let result =
        request_with_auth(method, path, body, port, auth_header, token, timeout, limit).await?;
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
    timeout: Duration,
    limit: usize,
) -> Result<Value, DesktopFailure> {
    let url = reqwest::Url::parse(&format!("http://127.0.0.1:{port}{path}"))
        .map_err(|_| DesktopFailure::invalid_input())?;
    request_url_with_auth(method, url, body, auth_header, token, timeout, limit, true).await
}

pub(super) async fn request_url_with_auth(
    method: reqwest::Method,
    url: reqwest::Url,
    body: Option<Value>,
    auth_header: &str,
    token: String,
    timeout: Duration,
    limit: usize,
    local: bool,
) -> Result<Value, DesktopFailure> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout);
    if local || remote_connections::is_loopback_url(&url) {
        builder = builder.no_proxy();
    }
    let client = builder
        .build()
        .map_err(|_| "无法建立配置连接".to_string())?;
    let mut request = client.request(method, url).header(auth_header, token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "配置请求失败".to_string())?;
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
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
        if bytes.len() + chunk.len() > limit {
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
pub async fn get_agent_config(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    config_request_to_profile(&state, &profile, reqwest::Method::GET, "/api/config", None).await
}

#[tauri::command]
pub async fn get_checkpoint_inventory(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let result = config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/ops/checkpoints",
        None,
    )
    .await?;
    let sessions = result
        .get("sessions")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let total_bytes = result
        .get("total_bytes")
        .and_then(Value::as_u64)
        .ok_or_else(DesktopFailure::operation_failed)?;
    if sessions.iter().any(|item| {
        item.get("session").and_then(Value::as_str).is_none()
            || item.get("files").and_then(Value::as_u64).is_none()
            || item.get("bytes").and_then(Value::as_u64).is_none()
    }) {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(json!({"sessions": sessions, "total_bytes": total_bytes}))
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
pub async fn save_auxiliary_route(
    state: State<'_, BackendState>,
    profile: String,
    task: String,
    provider: String,
    model: String,
    effort: String,
    timeout: Option<f64>,
) -> Result<Value, DesktopFailure> {
    if task.is_empty()
        || task.len() > 80
        || !task.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
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
    let target = resolve_config_target(&state, &profile).await?;
    let schema = target
        .request(&state, reqwest::Method::GET, "/api/config/schema", None)
        .await?;
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
    target
        .request(
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
    profile: String,
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
    let target = resolve_config_target(&state, &profile).await?;
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
        let schema = target
            .request(&state, reqwest::Method::GET, "/api/config/schema", None)
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
    let mut patch = value;
    for part in key.split('.').rev() {
        let mut object = serde_json::Map::new();
        object.insert(part.to_owned(), patch);
        patch = Value::Object(object);
    }
    target
        .request(
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
    profile: String,
    yaml_text: String,
    expected_yaml: String,
) -> Result<Value, DesktopFailure> {
    if yaml_text.len() > 256 * 1024 || expected_yaml.len() > 256 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let target = resolve_config_target(&state, &profile).await?;
    let current = target
        .request(&state, reqwest::Method::GET, "/api/config/raw", None)
        .await?;
    if current.get("yaml").and_then(Value::as_str) != Some(expected_yaml.as_str()) {
        return Err(DesktopFailure::conflict());
    }
    target
        .request(
            &state,
            reqwest::Method::PUT,
            "/api/config/raw",
            Some(json!({"yaml_text": yaml_text})),
        )
        .await
}

#[cfg(test)]
#[path = "tests/config.rs"]
mod tests;
