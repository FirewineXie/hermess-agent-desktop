//! Telegram QR setup using the locked fork's setup-service protocol.
//! The token stays in Rust; applying credentials uses the product-owned Gateway
//! config endpoint so the desktop remains the sole owner of Gateway restarts.
use super::{config::config_request_for_scope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::{Client, Method, Url};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::Mutex;
use uuid::Uuid;

const BASE: &str = "https://setup.hermes-agent.nousresearch.com";

#[derive(Default)]
pub struct TelegramSetupState(Mutex<HashMap<String, Pending>>);

#[derive(Clone)]
struct Pending {
    profile: String,
    gateway_epoch: String,
    pairing_id: String,
    poll_token: String,
    bot_token: Option<String>,
    owner_user_id: Option<String>,
    expires: Instant,
}

fn setup_client() -> Result<Client, DesktopFailure> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| DesktopFailure::connection_lost())
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}

fn telegram_link(value: &str) -> Result<String, DesktopFailure> {
    let url = Url::parse(value).map_err(|_| DesktopFailure::operation_failed())?;
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("t.me" | "telegram.me"))
        || url.username() != ""
        || url.password().is_some()
    {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(value.to_owned())
}

async fn remote(
    method: Method,
    path: &str,
    body: Option<Value>,
    bearer: Option<&str>,
) -> Result<Value, DesktopFailure> {
    let mut request = setup_client()?
        .request(method, format!("{BASE}{path}"))
        .header("Accept", "application/json");
    if let Some(body) = body {
        request = request.json(&body);
    }
    if let Some(token) = bearer {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    if !response.status().is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    response
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())
}

#[tauri::command]
pub async fn channel_telegram_start(
    state: State<'_, BackendState>,
    setups: State<'_, TelegramSetupState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("channel_telegram_start operation={operation} profile={profile}"),
    );
    let result: Result<Value, DesktopFailure> =
        async {
            let response = remote(
                Method::POST,
                "/v1/telegram/pairings",
                Some(json!({"bot_name": "Hermess Agent"})),
                None,
            )
            .await?;
            scope.ensure_current(&state).await?;
            let pairing_id = response
                .get("pairing_id")
                .and_then(Value::as_str)
                .ok_or_else(DesktopFailure::operation_failed)?;
            let poll_token = response
                .get("poll_token")
                .and_then(Value::as_str)
                .ok_or_else(DesktopFailure::operation_failed)?;
            let deep_link = response
                .get("deep_link")
                .or_else(|| response.get("qr_payload"))
                .and_then(Value::as_str)
                .ok_or_else(DesktopFailure::operation_failed)?;
            if !safe_id(pairing_id) || poll_token.is_empty() || poll_token.len() > 4096 {
                return Err(DesktopFailure::operation_failed());
            }
            let url = telegram_link(deep_link)?;
            let id = Uuid::new_v4().to_string();
            setups.0.lock().await.retain(|_, pending| {
                pending.expires > Instant::now() && pending.profile != profile
            });
            setups.0.lock().await.insert(
                id.clone(),
                Pending {
                    profile: profile.clone(),
                    gateway_epoch: scope.gateway_epoch.clone(),
                    pairing_id: pairing_id.to_owned(),
                    poll_token: poll_token.to_owned(),
                    bot_token: None,
                    owner_user_id: None,
                    expires: Instant::now() + Duration::from_secs(600),
                },
            );
            Ok(json!({"id": id, "url": url, "expires_in": 600}))
        }
        .await;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_telegram_start_{} operation={operation} pairing={} profile={profile}",
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            },
            result
                .as_ref()
                .ok()
                .and_then(|body| body.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("-")
        ),
    );
    result
}

#[tauri::command]
pub async fn channel_telegram_poll(
    state: State<'_, BackendState>,
    setups: State<'_, TelegramSetupState>,
    profile: String,
    id: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let pending = setups
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)?;
    if pending.profile != profile || pending.gateway_epoch != scope.gateway_epoch {
        return Err(DesktopFailure::conflict());
    }
    if pending.expires <= Instant::now() {
        setups.0.lock().await.remove(&id);
        return Ok(json!({"status": "expired"}));
    }
    if pending.bot_token.is_some() {
        return Ok(json!({"status": "ready", "owner_user_id": pending.owner_user_id}));
    }
    let response = setup_client()?
        .get(format!(
            "{BASE}/v1/telegram/pairings/{}",
            pending.pairing_id
        ))
        .bearer_auth(&pending.poll_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    if response.status().as_u16() == 410 {
        setups.0.lock().await.remove(&id);
        return Ok(json!({"status": "expired"}));
    }
    if !response.status().is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    let response: Value = response
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    scope.ensure_current(&state).await?;
    match response.get("status").and_then(Value::as_str) {
        Some("waiting") => Ok(json!({"status": "waiting"})),
        Some("ready") => {
            let token = response
                .get("token")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .ok_or_else(DesktopFailure::operation_failed)?;
            let owner = response.get("owner_user_id").and_then(|v| match v {
                Value::String(value)
                    if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) =>
                {
                    Some(value.clone())
                }
                Value::Number(value) => Some(value.to_string()),
                _ => None,
            });
            let mut records = setups.0.lock().await;
            let record = records.get_mut(&id).ok_or_else(DesktopFailure::conflict)?;
            record.bot_token = Some(token.to_owned());
            record.owner_user_id = owner.clone();
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!("channel_telegram_ready operation={id} profile={profile}"),
            );
            Ok(json!({"status": "ready", "owner_user_id": owner}))
        }
        Some("expired" | "claimed") => {
            setups.0.lock().await.remove(&id);
            Ok(json!({"status": "expired"}))
        }
        _ => Err(DesktopFailure::operation_failed()),
    }
}

#[tauri::command]
pub async fn channel_telegram_apply(
    state: State<'_, BackendState>,
    setups: State<'_, TelegramSetupState>,
    profile: String,
    id: String,
    allowed_user_id: String,
) -> Result<(), DesktopFailure> {
    let user_id = allowed_user_id.trim();
    if user_id.is_empty() || user_id.len() > 32 || !user_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let pending = setups
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)?;
    if pending.profile != profile || pending.gateway_epoch != scope.gateway_epoch {
        return Err(DesktopFailure::conflict());
    }
    if pending.expires <= Instant::now() {
        return Err(DesktopFailure::invalid_input());
    }
    let bot_token = pending.bot_token.ok_or_else(DesktopFailure::conflict)?;
    let result = config_request_for_scope(
        &state,
        &scope,
        Method::PUT,
        "/api/messaging/platforms/telegram",
        Some(json!({
            "profile": profile, "enabled": true,
            "env": {"TELEGRAM_BOT_TOKEN": bot_token, "TELEGRAM_ALLOWED_USERS": user_id},
        })),
    )
    .await;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_telegram_apply_{} operation={id} profile={profile}",
            if result
                .as_ref()
                .is_ok_and(|body| body.get("ok").and_then(Value::as_bool) == Some(true))
            {
                "completed"
            } else {
                "failed"
            }
        ),
    );
    if result?.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::operation_failed());
    }
    setups.0.lock().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn channel_telegram_cancel(
    state: State<'_, BackendState>,
    setups: State<'_, TelegramSetupState>,
    profile: String,
    id: String,
) -> Result<(), DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let mut records = setups.0.lock().await;
    if let Some(pending) = records.get(&id) {
        if pending.profile != profile || pending.gateway_epoch != scope.gateway_epoch {
            return Err(DesktopFailure::conflict());
        }
    }
    records.remove(&id);
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("channel_telegram_cancel operation={id} profile={profile}"),
    );
    Ok(())
}
