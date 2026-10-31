//! Product-owned access to the locked Gateway's channel configuration endpoints.
use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tauri::State;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct ChannelUpdate {
    env: HashMap<String, String>,
    clear_env: Vec<String>,
    enabled: Option<bool>,
}

fn valid_platform(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
}

async fn catalog(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    platform: &str,
) -> Result<Value, DesktopFailure> {
    if !valid_platform(platform) {
        return Err(DesktopFailure::invalid_input());
    }
    let result = config_request_for_scope(
        state,
        scope,
        reqwest::Method::GET,
        "/api/messaging/platforms",
        None,
    )
    .await?;
    result
        .get("platforms")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(platform))
        })
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)
}

fn validate_update(entry: &Value, update: &ChannelUpdate) -> Result<(), DesktopFailure> {
    let fields = entry
        .get("env_vars")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let allowed: HashSet<&str> = fields
        .iter()
        .filter_map(|f| f.get("key").and_then(Value::as_str))
        .collect();
    if update.env.len() > 64 || update.clear_env.len() > 64 {
        return Err(DesktopFailure::invalid_input());
    }
    for (key, value) in &update.env {
        if !allowed.contains(key.as_str()) || value.trim().is_empty() || value.len() > 8192 {
            return Err(DesktopFailure::invalid_input());
        }
    }
    for key in &update.clear_env {
        if !allowed.contains(key.as_str()) || update.env.contains_key(key) {
            return Err(DesktopFailure::invalid_input());
        }
    }
    if update.enabled == Some(true) {
        let any_configured = fields.iter().any(|field| {
            field.get("key").and_then(Value::as_str).is_some_and(|key| {
                update.env.contains_key(key)
                    || (field.get("is_set").and_then(Value::as_bool) == Some(true)
                        && !update.clear_env.iter().any(|removed| removed == key))
            })
        });
        if !any_configured {
            return Err(DesktopFailure::invalid_input());
        }
        // The locked dashboard omits these plugin requirements from required_env.
        // Keep the product's lazy activation rule even for those catalog rows.
        let extra_required: &[&str] = match entry.get("id").and_then(Value::as_str) {
            Some("yuanbao") => &["YUANBAO_APP_ID", "YUANBAO_APP_SECRET"],
            _ => &[],
        };
        for key in extra_required {
            let set = update.env.get(*key).is_some_and(|value| {
                *key != "WHATSAPP_ENABLED" || matches!(value.as_str(), "true" | "1" | "yes")
            }) || (fields.iter().any(|field| {
                field.get("key").and_then(Value::as_str) == Some(*key)
                    && field.get("is_set").and_then(Value::as_bool) == Some(true)
            }) && !update.clear_env.iter().any(|removed| removed == key));
            if !set {
                return Err(DesktopFailure::invalid_input());
            }
        }
        for field in fields {
            if field.get("required").and_then(Value::as_bool) != Some(true) {
                continue;
            }
            let key = field
                .get("key")
                .and_then(Value::as_str)
                .ok_or_else(DesktopFailure::operation_failed)?;
            let set = update.env.contains_key(key)
                || (field.get("is_set").and_then(Value::as_bool) == Some(true)
                    && !update.clear_env.iter().any(|removed| removed == key));
            if !set {
                return Err(DesktopFailure::invalid_input());
            }
        }
    }
    Ok(())
}

pub(super) fn whatsapp_session_linked(home: &Path) -> bool {
    // Mirrors locked get_hermes_dir(): populated legacy storage wins.
    let legacy = home.join("whatsapp").join("session");
    let current = home.join("platforms").join("whatsapp").join("session");
    let legacy_occupied = match legacy.metadata() {
        Ok(metadata) if metadata.is_dir() => match legacy.read_dir() {
            Ok(mut entries) => entries.next().is_some(),
            Err(_) => true,
        },
        Ok(_) => true,
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    };
    let session = if legacy_occupied { legacy } else { current };
    session.join("creds.json").is_file()
}

#[tauri::command]
pub async fn channel_save(
    state: State<'_, BackendState>,
    profile: String,
    platform: String,
    mut update: ChannelUpdate,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    if cfg!(windows) && platform == "matrix" && update.enabled == Some(true) {
        return Err(DesktopFailure::invalid_input());
    }
    if platform == "whatsapp" {
        if update.enabled == Some(true) {
            if !whatsapp_session_linked(&scope.home) {
                return Err(DesktopFailure::invalid_input());
            }
            update.env.insert("WHATSAPP_ENABLED".into(), "true".into());
            update.clear_env.retain(|key| key != "WHATSAPP_ENABLED");
        } else if update.enabled != Some(false)
            && update
                .env
                .get("WHATSAPP_ENABLED")
                .is_some_and(|value| matches!(value.as_str(), "true" | "1" | "yes"))
        {
            return Err(DesktopFailure::invalid_input());
        }
    }
    let entry = catalog(&state, &scope, &platform).await?;
    validate_update(&entry, &update)?;
    let clears_required = entry
        .get("env_vars")
        .and_then(Value::as_array)
        .is_some_and(|fields| {
            fields.iter().any(|field| {
                field.get("required").and_then(Value::as_bool) == Some(true)
                    && field
                        .get("key")
                        .and_then(Value::as_str)
                        .is_some_and(|key| update.clear_env.iter().any(|removed| removed == key))
            })
        });
    if clears_required {
        update.enabled = Some(false);
    }
    let operation = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("channel_save_start operation={operation} profile={profile} platform={platform}"),
    );
    let result = config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::PUT,
        &format!("/api/messaging/platforms/{platform}"),
        Some(json!({"profile": profile, "env": update.env, "clear_env": update.clear_env, "enabled": update.enabled})),
    )
    .await;
    let outcome = if result
        .as_ref()
        .is_ok_and(|body| body.get("ok").and_then(Value::as_bool) == Some(true))
    {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_save_{outcome} operation={operation} profile={profile} platform={platform}"
        ),
    );
    let result = result?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(json!({"hot_served": result.get("hot_served").and_then(Value::as_bool).unwrap_or(false)}))
}

#[tauri::command]
pub async fn channel_test(
    state: State<'_, BackendState>,
    profile: String,
    platform: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let _ = catalog(&state, &scope, &platform).await?;
    let operation = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("channel_test_start operation={operation} profile={profile} platform={platform}"),
    );
    let result = config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::POST,
        &format!("/api/messaging/platforms/{platform}/test"),
        None,
    )
    .await;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_test_{} operation={operation} profile={profile} platform={platform}",
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            }
        ),
    );
    let result = result?;
    Ok(json!({
        "ok": result.get("ok").and_then(Value::as_bool).unwrap_or(false),
        "state": result.get("state").and_then(Value::as_str).unwrap_or("unknown"),
        "auth_posture": result.get("auth_posture").and_then(Value::as_str),
    }))
}

#[cfg(test)]
#[path = "tests/channel_manage.rs"]
mod tests;
