use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

const EXCLUDED_ACCOUNT_PROVIDER: &str = "nous";

#[derive(Debug, Serialize)]
pub struct ModelOAuthProviderStatus {
    logged_in: bool,
    source: Option<String>,
    source_label: Option<String>,
    token_preview: Option<String>,
    expires_at: Option<String>,
    has_refresh_token: bool,
    last_refresh: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ModelOAuthProvider {
    id: String,
    name: String,
    flow: String,
    cli_command: String,
    docs_url: Option<String>,
    disconnect_hint: Option<String>,
    disconnect_command: Option<String>,
    disconnectable: bool,
    status: ModelOAuthProviderStatus,
}

#[derive(Debug, Serialize)]
pub struct ModelOAuthProviders {
    providers: Vec<ModelOAuthProvider>,
}

#[derive(Debug, Serialize)]
pub struct ModelOAuthStart {
    session_id: String,
    flow: String,
    user_code: String,
    verification_url: String,
    expires_in: u64,
    poll_interval: u64,
}

#[derive(Debug, Serialize)]
pub struct ModelOAuthPoll {
    session_id: String,
    status: String,
    error_message: Option<String>,
    expires_at: Option<f64>,
    reason: Option<String>,
    retryable: bool,
    retry_after: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ModelOAuthMutation {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
}

fn bounded_string(
    value: &Value,
    field: &str,
    max: usize,
) -> Result<Option<String>, DesktopFailure> {
    let Some(raw) = value.get(field) else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    let text = raw.as_str().ok_or_else(DesktopFailure::operation_failed)?;
    if text.len() > max || text.contains('\0') {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(Some(text.to_owned()))
}

fn valid_identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn identifier(value: &str, max: usize) -> Result<&str, DesktopFailure> {
    valid_identifier(value, max)
        .then_some(value)
        .ok_or_else(DesktopFailure::invalid_input)
}

fn safe_https_url(value: &str) -> Result<String, DesktopFailure> {
    let url = reqwest::Url::parse(value).map_err(|_| DesktopFailure::operation_failed())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(url.to_string())
}

fn path_with_profile(profile: &str, segments: &[&str]) -> Result<String, DesktopFailure> {
    let mut url = reqwest::Url::parse("http://localhost/api/providers/oauth")
        .map_err(|_| DesktopFailure::operation_failed())?;
    {
        let mut path = url
            .path_segments_mut()
            .map_err(|_| DesktopFailure::operation_failed())?;
        for segment in segments {
            path.push(segment);
        }
    }
    url.query_pairs_mut().append_pair("profile", profile);
    Ok(format!(
        "{}?{}",
        url.path(),
        url.query().ok_or_else(DesktopFailure::operation_failed)?
    ))
}

pub(super) fn request_shape(
    profile: &str,
    operation: &str,
    provider: Option<&str>,
    session_id: Option<&str>,
) -> Result<(Method, String, Option<Value>), DesktopFailure> {
    let provider = provider.map(|value| identifier(value, 128)).transpose()?;
    if provider == Some(EXCLUDED_ACCOUNT_PROVIDER) {
        return Err(DesktopFailure::invalid_input());
    }
    let session_id = session_id.map(|value| identifier(value, 256)).transpose()?;
    match operation {
        "list" if provider.is_none() && session_id.is_none() => {
            Ok((Method::GET, path_with_profile(profile, &[])?, None))
        }
        "start" if session_id.is_none() => Ok((
            Method::POST,
            path_with_profile(
                profile,
                &[provider.ok_or_else(DesktopFailure::invalid_input)?, "start"],
            )?,
            Some(json!({})),
        )),
        "poll" => Ok((
            Method::GET,
            path_with_profile(
                profile,
                &[
                    provider.ok_or_else(DesktopFailure::invalid_input)?,
                    "poll",
                    session_id.ok_or_else(DesktopFailure::invalid_input)?,
                ],
            )?,
            None,
        )),
        "cancel" if provider.is_none() => Ok((
            Method::DELETE,
            path_with_profile(
                profile,
                &[
                    "sessions",
                    session_id.ok_or_else(DesktopFailure::invalid_input)?,
                ],
            )?,
            None,
        )),
        "disconnect" if session_id.is_none() => Ok((
            Method::DELETE,
            path_with_profile(
                profile,
                &[provider.ok_or_else(DesktopFailure::invalid_input)?],
            )?,
            None,
        )),
        _ => Err(DesktopFailure::invalid_input()),
    }
}

fn project_status(value: &Value) -> Result<ModelOAuthProviderStatus, DesktopFailure> {
    if !value.is_object() {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(ModelOAuthProviderStatus {
        logged_in: value
            .get("logged_in")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        source: bounded_string(value, "source", 256)?,
        source_label: bounded_string(value, "source_label", 1024)?,
        token_preview: bounded_string(value, "token_preview", 128)?,
        expires_at: bounded_string(value, "expires_at", 128)?,
        has_refresh_token: value
            .get("has_refresh_token")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        last_refresh: bounded_string(value, "last_refresh", 128)?,
        error: bounded_string(value, "error", 1024)?,
    })
}

fn project_provider(value: &Value) -> Result<ModelOAuthProvider, DesktopFailure> {
    let id = bounded_string(value, "id", 128)?
        .filter(|value| valid_identifier(value, 128))
        .ok_or_else(DesktopFailure::operation_failed)?;
    let name = bounded_string(value, "name", 256)?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(DesktopFailure::operation_failed)?;
    let flow = bounded_string(value, "flow", 32)?
        .filter(|value| matches!(value.as_str(), "device_code" | "external" | "pkce"))
        .ok_or_else(DesktopFailure::operation_failed)?;
    let docs_url = bounded_string(value, "docs_url", 2048)?
        .filter(|value| !value.is_empty())
        .map(|value| safe_https_url(&value))
        .transpose()?;
    Ok(ModelOAuthProvider {
        id,
        name,
        flow,
        cli_command: bounded_string(value, "cli_command", 1024)?.unwrap_or_default(),
        docs_url,
        disconnect_hint: bounded_string(value, "disconnect_hint", 1024)?,
        disconnect_command: bounded_string(value, "disconnect_command", 1024)?,
        disconnectable: value
            .get("disconnectable")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        status: project_status(
            value
                .get("status")
                .ok_or_else(DesktopFailure::operation_failed)?,
        )?,
    })
}

fn project_providers(value: Value) -> Result<ModelOAuthProviders, DesktopFailure> {
    let rows = value
        .get("providers")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::operation_failed)?;
    if rows.len() > 256 {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(ModelOAuthProviders {
        providers: rows
            .iter()
            .filter(|value| {
                value.get("id").and_then(Value::as_str) != Some(EXCLUDED_ACCOUNT_PROVIDER)
            })
            .map(project_provider)
            .collect::<Result<_, _>>()?,
    })
}

fn project_start(value: Value) -> Result<ModelOAuthStart, DesktopFailure> {
    let session_id = bounded_string(&value, "session_id", 256)?
        .filter(|value| valid_identifier(value, 256))
        .ok_or_else(DesktopFailure::operation_failed)?;
    let user_code = bounded_string(&value, "user_code", 256)?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(DesktopFailure::operation_failed)?;
    let verification_url = bounded_string(&value, "verification_url", 2048)?
        .ok_or_else(DesktopFailure::operation_failed)
        .and_then(|value| safe_https_url(&value))?;
    let expires_in = value
        .get("expires_in")
        .and_then(Value::as_u64)
        .filter(|value| (1..=86_400).contains(value))
        .ok_or_else(DesktopFailure::operation_failed)?;
    let poll_interval = value
        .get("poll_interval")
        .and_then(Value::as_u64)
        .filter(|value| (1..=60).contains(value))
        .ok_or_else(DesktopFailure::operation_failed)?;
    if value.get("flow").and_then(Value::as_str) != Some("device_code") {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(ModelOAuthStart {
        session_id,
        flow: "device_code".into(),
        user_code,
        verification_url,
        expires_in,
        poll_interval,
    })
}

fn project_poll(value: Value) -> Result<ModelOAuthPoll, DesktopFailure> {
    let session_id = bounded_string(&value, "session_id", 256)?
        .filter(|value| valid_identifier(value, 256))
        .ok_or_else(DesktopFailure::operation_failed)?;
    let status = bounded_string(&value, "status", 32)?
        .filter(|value| {
            matches!(
                value.as_str(),
                "pending" | "approved" | "denied" | "expired" | "error" | "cancelled"
            )
        })
        .ok_or_else(DesktopFailure::operation_failed)?;
    let expires_at = value.get("expires_at").and_then(Value::as_f64);
    if expires_at.is_some_and(|value| !value.is_finite() || value < 0.0) {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(ModelOAuthPoll {
        session_id,
        status,
        error_message: bounded_string(&value, "error_message", 2048)?,
        expires_at,
        reason: bounded_string(&value, "reason", 256)?,
        retryable: value
            .get("retryable")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        retry_after: value.get("retry_after").and_then(Value::as_u64),
    })
}

async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    provider: Option<&str>,
    session_id: Option<&str>,
) -> Result<Value, DesktopFailure> {
    let (method, path, body) = request_shape(&scope.profile, operation, provider, session_id)?;
    config_request_for_scope(state, scope, method, &path, body).await
}

async fn mutation(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    provider: Option<&str>,
    session_id: Option<&str>,
) -> Result<Value, DesktopFailure> {
    let id = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "model_oauth operation={id} phase=start action={operation} profile={} provider={}",
            scope.profile,
            provider.unwrap_or("-")
        ),
    );
    let result = request(state, scope, operation, provider, session_id).await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "model_oauth operation={id} phase=finish action={operation} profile={} provider={} status={outcome}",
            scope.profile,
            provider.unwrap_or("-")
        ),
    );
    result
}

#[tauri::command]
pub async fn list_model_oauth_providers(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<ModelOAuthProviders, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    project_providers(request(&state, &scope, "list", None, None).await?)
}

#[tauri::command]
pub async fn start_model_oauth(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
) -> Result<ModelOAuthStart, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    project_start(mutation(&state, &scope, "start", Some(&provider), None).await?)
}

#[tauri::command]
pub async fn poll_model_oauth(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
    session_id: String,
) -> Result<ModelOAuthPoll, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    project_poll(request(&state, &scope, "poll", Some(&provider), Some(&session_id)).await?)
}

#[tauri::command]
pub async fn cancel_model_oauth(
    state: State<'_, BackendState>,
    profile: String,
    session_id: String,
) -> Result<ModelOAuthMutation, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let value = mutation(&state, &scope, "cancel", None, Some(&session_id)).await?;
    Ok(ModelOAuthMutation {
        ok: value.get("ok").and_then(Value::as_bool).unwrap_or(false),
        provider: None,
    })
}

#[tauri::command]
pub async fn disconnect_model_oauth(
    state: State<'_, BackendState>,
    profile: String,
    provider: String,
) -> Result<ModelOAuthMutation, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let value = mutation(&state, &scope, "disconnect", Some(&provider), None).await?;
    let returned = bounded_string(&value, "provider", 128)?
        .filter(|value| valid_identifier(value, 128))
        .ok_or_else(DesktopFailure::operation_failed)?;
    Ok(ModelOAuthMutation {
        ok: value.get("ok").and_then(Value::as_bool) == Some(true),
        provider: Some(returned),
    })
}

#[cfg(test)]
#[path = "tests/model_oauth.rs"]
mod tests;
