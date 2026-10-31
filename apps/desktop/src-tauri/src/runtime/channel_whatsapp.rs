//! WhatsApp QR setup through the locked Dashboard, with desktop-owned restart.
use super::{
    channel_manage::whatsapp_session_linked, config::config_request_for_scope, BackendState,
};
use crate::errors::DesktopFailure;
use reqwest::Method;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
pub struct WhatsAppSetupState(Mutex<HashMap<String, Pending>>);

pub(crate) async fn cancel_all(
    state: &State<'_, BackendState>,
    setups: &State<'_, WhatsAppSetupState>,
) {
    let pending: Vec<(String, Pending)> = setups
        .0
        .lock()
        .await
        .iter()
        .map(|(id, record)| (id.clone(), record.clone()))
        .collect();
    for (id, record) in pending {
        let Ok(scope) = state.resolve_profile(&record.profile).await else {
            continue;
        };
        if record.epoch != scope.gateway_epoch {
            continue;
        }
        let Ok(route) = path(&record.pairing_id) else {
            continue;
        };
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            config_request_for_scope(state, &scope, Method::DELETE, &route, None),
        )
        .await;
        let completed = matches!(&result, Ok(Ok(body)) if body.get("ok").and_then(Value::as_bool) == Some(true));
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "channel_whatsapp_shutdown_cleanup_{} operation={id} profile={}",
                if completed { "completed" } else { "failed" },
                record.profile
            ),
        );
        if completed {
            setups.0.lock().await.remove(&id);
        }
    }
}

#[derive(Clone)]
struct Pending {
    profile: String,
    epoch: String,
    pairing_id: String,
    expires: Instant,
    ready: bool,
    existing: bool,
}

fn safe_pairing_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
}

fn path(id: &str) -> Result<String, DesktopFailure> {
    if !safe_pairing_id(id) {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(format!("/api/messaging/whatsapp/onboarding/{id}"))
}

#[tauri::command]
pub async fn channel_whatsapp_start(
    state: State<'_, BackendState>,
    setups: State<'_, WhatsAppSetupState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    if setups
        .0
        .lock()
        .await
        .values()
        .any(|p| p.profile == profile && p.expires > Instant::now())
    {
        return Err(DesktopFailure::conflict());
    }
    let operation = Uuid::new_v4().to_string();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("channel_whatsapp_start operation={operation} profile={profile}"),
    );
    let result = config_request_for_scope(
        &state,
        &scope,
        Method::POST,
        "/api/messaging/whatsapp/onboarding/start",
        Some(
            json!({"profile": profile, "mode": "bot", "allowed_users": "", "reset_session": false}),
        ),
    )
    .await;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_whatsapp_start_request_{} operation={operation} profile={profile}",
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            }
        ),
    );
    let response = result?;
    let pairing_id = response
        .get("pairing_id")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let _ = path(pairing_id)?;
    let existing = response.get("status").and_then(Value::as_str) == Some("connected");
    let id = Uuid::new_v4().to_string();
    setups.0.lock().await.insert(
        id.clone(),
        Pending {
            profile: profile.clone(),
            epoch: scope.gateway_epoch,
            pairing_id: pairing_id.to_owned(),
            expires: Instant::now() + Duration::from_secs(600),
            ready: existing,
            existing,
        },
    );
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_whatsapp_pairing_created operation={operation} pairing={id} profile={profile}"
        ),
    );
    Ok(
        json!({"id": id, "status": if existing {"ready"} else {"waiting"},
        "qr_payload": response.get("qr_payload").and_then(Value::as_str).filter(|v| v.len() <= 16384)}),
    )
}

#[tauri::command]
pub async fn channel_whatsapp_poll(
    state: State<'_, BackendState>,
    setups: State<'_, WhatsAppSetupState>,
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
    if pending.profile != profile || pending.epoch != scope.gateway_epoch {
        return Err(DesktopFailure::conflict());
    }
    if pending.expires <= Instant::now() {
        setups.0.lock().await.remove(&id);
        return Ok(json!({"status":"expired"}));
    }
    if pending.ready {
        return Ok(json!({"status":"ready"}));
    }
    let response = config_request_for_scope(
        &state,
        &scope,
        Method::GET,
        &path(&pending.pairing_id)?,
        None,
    )
    .await;
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!("channel_whatsapp_poll_failed operation={id} profile={profile}"),
            );
            return Err(error);
        }
    };
    let status = response.get("status").and_then(Value::as_str).unwrap_or("");
    match status {
        "connected" => {
            if let Some(record) = setups.0.lock().await.get_mut(&id) {
                record.ready = true;
            }
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!("channel_whatsapp_ready operation={id} profile={profile}"),
            );
            Ok(json!({"status":"ready"}))
        }
        "expired" | "cancelled" | "error" => {
            setups.0.lock().await.remove(&id);
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!("channel_whatsapp_failed operation={id} profile={profile} state={status}"),
            );
            Ok(json!({"status": if status == "expired" {"expired"} else {"failed"}}))
        }
        "starting" | "installing" | "waiting" => {
            let qr = response
                .get("qr_payload")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty() && v.len() <= 16384);
            Ok(json!({"status":"waiting", "qr_payload": qr}))
        }
        _ => Err(DesktopFailure::operation_failed()),
    }
}

#[tauri::command]
pub async fn channel_whatsapp_apply(
    state: State<'_, BackendState>,
    setups: State<'_, WhatsAppSetupState>,
    profile: String,
    id: String,
) -> Result<(), DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let pending = setups
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)?;
    if pending.profile != profile || pending.epoch != scope.gateway_epoch {
        return Err(DesktopFailure::conflict());
    }
    if !pending.ready || pending.expires <= Instant::now() {
        return Err(DesktopFailure::conflict());
    }
    // The bridge reports connected before its two-second credential flush/exit delay.
    if !pending.existing {
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    scope.ensure_current(&state).await?;
    if !whatsapp_session_linked(&scope.home) {
        return Err(DesktopFailure::conflict());
    }
    let result = config_request_for_scope(&state, &scope, Method::PUT,
        "/api/messaging/platforms/whatsapp",
        Some(json!({"profile": profile, "enabled": true,
            "env": {"WHATSAPP_MODE": "bot", "WHATSAPP_DM_POLICY": "pairing", "WHATSAPP_ENABLED": "true"},
            "clear_env": []}))).await;
    let success = result
        .as_ref()
        .is_ok_and(|body| body.get("ok").and_then(Value::as_bool) == Some(true));
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_whatsapp_apply_{} operation={id} profile={profile}",
            if success { "completed" } else { "failed" }
        ),
    );
    if !success {
        return Err(result
            .err()
            .unwrap_or_else(DesktopFailure::operation_failed));
    }
    let cleanup = config_request_for_scope(
        &state,
        &scope,
        Method::DELETE,
        &path(&pending.pairing_id)?,
        None,
    )
    .await;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_whatsapp_pairing_cleanup_{} operation={id} profile={profile}",
            if cleanup
                .as_ref()
                .is_ok_and(|body| body.get("ok").and_then(Value::as_bool) == Some(true))
            {
                "completed"
            } else {
                "failed"
            }
        ),
    );
    setups.0.lock().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn channel_whatsapp_cancel(
    state: State<'_, BackendState>,
    setups: State<'_, WhatsAppSetupState>,
    profile: String,
    id: String,
) -> Result<(), DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let pending = setups
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)?;
    if pending.profile != profile || pending.epoch != scope.gateway_epoch {
        return Err(DesktopFailure::conflict());
    }
    let result = config_request_for_scope(
        &state,
        &scope,
        Method::DELETE,
        &path(&pending.pairing_id)?,
        None,
    )
    .await;
    if result
        .as_ref()
        .is_ok_and(|body| body.get("ok").and_then(Value::as_bool) == Some(true))
    {
        setups.0.lock().await.remove(&id);
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!("channel_whatsapp_cancel operation={id} profile={profile}"),
        );
        Ok(())
    } else {
        Err(result
            .err()
            .unwrap_or_else(DesktopFailure::operation_failed))
    }
}

#[cfg(test)]
#[path = "tests/channel_whatsapp.rs"]
mod tests;
