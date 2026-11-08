use super::BackendState;
use crate::errors::DesktopFailure;
use crate::gateway::GatewayRequestError;
use crate::paths::{filesystem_path, plain_path};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

pub(super) fn session_create_params(
    cwd: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    reasoning: Option<String>,
) -> Value {
    let mut params = json!({
        "source": "gui", "request_id": Uuid::new_v4().to_string()
    });
    if let Some(cwd) = cwd {
        params["cwd"] = json!(cwd);
        params["cwd_explicit"] = json!(true);
    }
    if let (Some(provider), Some(model)) = (provider, model) {
        params["provider"] = json!(provider);
        params["model"] = json!(model);
    }
    if let Some(reasoning) = reasoning {
        params["reasoning"] = json!(reasoning);
    }
    params
}

pub(super) fn validate_workspace_path(
    cwd: Option<String>,
) -> Result<Option<String>, DesktopFailure> {
    let Some(path) = cwd.filter(|path| !path.trim().is_empty()) else {
        return Ok(None);
    };
    let directory = plain_path(PathBuf::from(&path).as_path());
    if !directory.is_absolute() || !filesystem_path(&directory).is_dir() {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(Some(directory.to_string_lossy().into_owned()))
}

pub(super) async fn create(
    state: State<'_, BackendState>,
    profile: String,
    cwd: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    reasoning: Option<String>,
) -> Result<Value, DesktopFailure> {
    let cwd = validate_workspace_path(cwd)?;
    if provider.as_deref().is_some_and(|value| {
        value.is_empty() || value.len() > 128 || value.chars().any(char::is_whitespace)
    }) || model.as_deref().is_some_and(|value| {
        value.is_empty() || value.len() > 256 || value.chars().any(char::is_whitespace)
    }) || provider.is_some() != model.is_some()
        || reasoning.as_deref().is_some_and(|value| {
            !matches!(
                value,
                "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
            )
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_chat_profile(&profile).await?;
    let mut params = session_create_params(cwd, provider, model, reasoning);
    let operation = params["request_id"].as_str().unwrap_or("").to_owned();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("chat_session_create_start operation={operation} profile={profile}"),
    );
    let environment = scope.client_environment().await.inspect_err(|_| {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "ERROR chat_session_environment_failed operation={operation} profile={profile}"
            ),
        );
    })?;
    if let Some((environment, count)) = environment {
        params["client_env"] = environment;
        let _ = crate::diagnostics::append_client_event(&scope.storage,
            &format!("chat_session_environment_prepared operation={operation} profile={profile} managed_path_count={count}"));
    }
    scope.ensure_current(&state).await.inspect_err(|_| {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "ERROR chat_session_create_superseded operation={operation} profile={profile}"
            ),
        );
    })?;
    let result = scope
        .gateway
        .request_detailed("session.create", params)
        .await;
    let outcome = match &result {
        Ok(value)
            if value.get("session_id").and_then(Value::as_str).is_some()
                && value
                    .get("stored_session_id")
                    .and_then(Value::as_str)
                    .is_some() =>
        {
            "completed=true".to_owned()
        }
        Ok(_) => "failed=true kind=incomplete_result".to_owned(),
        Err(GatewayRequestError::Rpc { code, .. }) => format!("failed=true kind=rpc code={code}"),
        Err(GatewayRequestError::Transport(_)) => "failed=true kind=transport".to_owned(),
    };
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("chat_session_create_result operation={operation} profile={profile} {outcome}"),
    );
    let result = result.map_err(|error| DesktopFailure::from(error.to_string()))?;
    if result.get("session_id").and_then(Value::as_str).is_none()
        || result
            .get("stored_session_id")
            .and_then(Value::as_str)
            .is_none()
    {
        return Err("网关未返回完整会话标识".into());
    }
    Ok(result)
}
