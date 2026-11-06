use super::{
    profile_scope::valid_profile_name,
    profiles::{roster_contains, settle_renamed_selection},
    BackendState,
};
use crate::errors::DesktopFailure;
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use tauri::State;

const RESPONSE_LIMIT: u64 = 1024 * 1024;
const SETUP_COMMAND_LIMIT: usize = 16 * 1024;

fn valid_rename(name: &str, new_name: &str) -> bool {
    name != "default"
        && new_name != "default"
        && name != new_name
        && valid_profile_name(name)
        && valid_profile_name(new_name)
}

struct ProfileRequestContext {
    client: Arc<crate::gateway::GatewayClient>,
    storage: std::path::PathBuf,
    port: u16,
    token: String,
}

async fn context(
    state: &State<'_, BackendState>,
    profile: &str,
) -> Result<ProfileRequestContext, DesktopFailure> {
    if !valid_profile_name(profile) {
        return Err(DesktopFailure::invalid_input());
    }
    let (client, storage, port, token) = {
        let owned = state.0.lock().await;
        let backend = owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        (
            Arc::clone(&backend.gateway),
            backend.storage.clone(),
            backend.port,
            backend.token.clone(),
        )
    };
    let roster = client
        .request("profiles.list", json!({"include_sessions": false}))
        .await?;
    if !roster_contains(&roster, profile) {
        return Err(DesktopFailure::invalid_input());
    }
    let owned = state.0.lock().await;
    let backend = owned
        .as_ref()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    if backend.storage != storage || backend.port != port || !Arc::ptr_eq(&backend.gateway, &client)
    {
        return Err(DesktopFailure::conflict());
    }
    Ok(ProfileRequestContext {
        client,
        storage,
        port,
        token,
    })
}

async fn request(
    context: &ProfileRequestContext,
    method: Method,
    path: &str,
    body: Option<Value>,
    timeout_seconds: u64,
) -> Result<Value, DesktopFailure> {
    let mut request = super::local_http::client()?
        .request(method, format!("http://127.0.0.1:{}{path}", context.port))
        .timeout(Duration::from_secs(timeout_seconds))
        .header("X-Hermes-Session-Token", &context.token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            DesktopFailure::timeout()
        } else {
            DesktopFailure::connection_lost()
        }
    })?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    if bytes.len() as u64 > RESPONSE_LIMIT {
        return Err(DesktopFailure::operation_failed());
    }
    if !status.is_success() {
        return Err(
            if matches!(
                status,
                StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND | StatusCode::CONFLICT
            ) {
                DesktopFailure::invalid_input()
            } else {
                DesktopFailure::operation_failed()
            },
        );
    }
    serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())
}

#[tauri::command]
pub async fn get_profile_identity(
    state: State<'_, BackendState>,
    name: String,
) -> Result<Value, DesktopFailure> {
    let name = name.trim();
    let context = context(&state, name).await?;
    let result = request(&context, Method::GET, "/api/profiles", None, 20).await?;
    ensure_current(&state, &context).await?;
    let row = result
        .get("profiles")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter()
                .find(|row| row.get("name").and_then(Value::as_str) == Some(name))
        })
        .ok_or_else(DesktopFailure::operation_failed)?;
    Ok(json!({
        "description": row.get("description").and_then(Value::as_str).unwrap_or(""),
        "description_auto": row.get("description_auto").and_then(Value::as_bool).unwrap_or(false),
    }))
}

fn setup_command_path(name: &str) -> String {
    format!("/api/profiles/{name}/setup-command")
}

#[tauri::command]
pub async fn get_profile_setup_command(
    state: State<'_, BackendState>,
    name: String,
) -> Result<Value, DesktopFailure> {
    let name = name.trim();
    let context = context(&state, name).await?;
    let _ = crate::diagnostics::append_client_event(
        &context.storage,
        &format!("profile_setup_command_read_start profile={name}"),
    );
    let result = request(&context, Method::GET, &setup_command_path(name), None, 20).await;
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            let _ = crate::diagnostics::append_client_event(
                &context.storage,
                &format!("profile_setup_command_read_failed profile={name} reason=request"),
            );
            return Err(error);
        }
    };
    if let Err(error) = ensure_current(&state, &context).await {
        let _ = crate::diagnostics::append_client_event(
            &context.storage,
            &format!("profile_setup_command_read_failed profile={name} reason=runtime_changed"),
        );
        return Err(error);
    }
    let command = result
        .get("command")
        .and_then(Value::as_str)
        .filter(|command| !command.trim().is_empty() && command.len() <= SETUP_COMMAND_LIMIT)
        .ok_or_else(DesktopFailure::operation_failed);
    let command = match command {
        Ok(command) => command,
        Err(error) => {
            let _ = crate::diagnostics::append_client_event(
                &context.storage,
                &format!("profile_setup_command_read_failed profile={name} reason=response"),
            );
            return Err(error);
        }
    };
    let _ = crate::diagnostics::append_client_event(
        &context.storage,
        &format!("profile_setup_command_read_completed profile={name}"),
    );
    Ok(json!({"command": command}))
}

async fn ensure_current(
    state: &State<'_, BackendState>,
    context: &ProfileRequestContext,
) -> Result<(), DesktopFailure> {
    let owned = state.0.lock().await;
    let backend = owned
        .as_ref()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    if backend.storage != context.storage
        || backend.port != context.port
        || !Arc::ptr_eq(&backend.gateway, &context.client)
    {
        return Err(DesktopFailure::conflict());
    }
    Ok(())
}

#[tauri::command]
pub async fn rename_profile_id(
    state: State<'_, BackendState>,
    name: String,
    new_name: String,
) -> Result<Value, DesktopFailure> {
    let name = name.trim();
    let new_name = new_name.trim();
    if !valid_rename(name, new_name) {
        return Err(DesktopFailure::invalid_input());
    }
    let context = context(&state, name).await?;
    let _ = crate::diagnostics::append_client_event(
        &context.storage,
        &format!("profile_id_rename_start profile={name} target={new_name}"),
    );
    let result = request(
        &context,
        Method::PATCH,
        &format!("/api/profiles/{name}"),
        Some(json!({"new_name": new_name})),
        45,
    )
    .await;
    let result = match result {
        Ok(result) if result.get("name").and_then(Value::as_str) == Some(new_name) => result,
        Ok(_) => {
            let _ = crate::diagnostics::append_client_event(
                &context.storage,
                &format!("profile_id_rename_failed profile={name} reason=response"),
            );
            return Err(DesktopFailure::operation_failed());
        }
        Err(error) => {
            let _ = crate::diagnostics::append_client_event(
                &context.storage,
                &format!("profile_id_rename_failed profile={name} reason=request"),
            );
            return Err(error);
        }
    };
    ensure_current(&state, &context).await?;
    let selection_persisted =
        settle_renamed_selection(&state, &context.client, &context.storage, name, new_name).await?;
    if !selection_persisted {
        let _ = crate::diagnostics::append_client_event(
            &context.storage,
            &format!("profile_id_rename_selection_persist_failed profile={new_name}"),
        );
    }
    let _ = crate::diagnostics::append_client_event(
        &context.storage,
        &format!("profile_id_rename_completed profile={new_name}"),
    );
    Ok(json!({
        "name": result["name"],
        "selection_persisted": selection_persisted,
    }))
}

#[tauri::command]
pub async fn save_profile_description(
    state: State<'_, BackendState>,
    name: String,
    description: String,
) -> Result<Value, DesktopFailure> {
    if description.len() > 1024 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let name = name.trim();
    let context = context(&state, name).await?;
    let _ = crate::diagnostics::append_client_event(
        &context.storage,
        &format!("profile_description_save_start profile={name}"),
    );
    let result = request(
        &context,
        Method::PUT,
        &format!("/api/profiles/{name}/description"),
        Some(json!({"description": description})),
        20,
    )
    .await;
    match result {
        Ok(result) if result.get("ok").and_then(Value::as_bool) == Some(true) => {
            ensure_current(&state, &context).await?;
            state.2.lock().await.take();
            let _ = crate::diagnostics::append_client_event(
                &context.storage,
                &format!("profile_description_save_completed profile={name}"),
            );
            Ok(result)
        }
        Ok(_) => {
            let _ = crate::diagnostics::append_client_event(
                &context.storage,
                &format!("profile_description_save_failed profile={name} reason=response"),
            );
            Err(DesktopFailure::operation_failed())
        }
        Err(error) => {
            let _ = crate::diagnostics::append_client_event(
                &context.storage,
                &format!("profile_description_save_failed profile={name} reason=request"),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn describe_profile_auto(
    state: State<'_, BackendState>,
    name: String,
    overwrite: bool,
) -> Result<Value, DesktopFailure> {
    let name = name.trim();
    let context = context(&state, name).await?;
    let _ = crate::diagnostics::append_client_event(
        &context.storage,
        &format!("profile_description_auto_start profile={name} overwrite={overwrite}"),
    );
    let result = request(
        &context,
        Method::POST,
        &format!("/api/profiles/{name}/describe-auto"),
        Some(json!({"overwrite": overwrite})),
        75,
    )
    .await;
    match result {
        Ok(result) => {
            ensure_current(&state, &context).await?;
            if result.get("ok").and_then(Value::as_bool) == Some(true) {
                state.2.lock().await.take();
            }
            let outcome = if result.get("ok").and_then(Value::as_bool) == Some(true) {
                "completed"
            } else {
                "declined"
            };
            let _ = crate::diagnostics::append_client_event(
                &context.storage,
                &format!("profile_description_auto_{outcome} profile={name}"),
            );
            Ok(result)
        }
        Err(error) => {
            let _ = crate::diagnostics::append_client_event(
                &context.storage,
                &format!("profile_description_auto_failed profile={name}"),
            );
            Err(error)
        }
    }
}

#[cfg(test)]
#[path = "tests/profile_identity.rs"]
mod tests;
