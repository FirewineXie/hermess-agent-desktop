use super::{
    config::config_request_for_scope, profile_scope::ResolvedProfileScope, system_actions,
    BackendState,
};
use crate::errors::DesktopFailure;
use reqwest::{Method, Url};
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

#[cfg(test)]
fn run_args(profile: &str) -> [&str; 4] {
    ["-p", profile, "curator", "run"]
}

fn path(port: u16, profile: &str, paused: bool) -> Result<String, DesktopFailure> {
    let endpoint = if paused {
        "/api/curator/paused"
    } else {
        "/api/curator"
    };
    let mut url = Url::parse(&format!("http://127.0.0.1:{port}{endpoint}"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    url.query_pairs_mut().append_pair("profile", profile);
    Ok(format!("{}?{}", url.path(), url.query().unwrap_or("")))
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    if payload
        .get("profile")
        .and_then(Value::as_str)
        .is_some_and(|value| value != scope.profile)
    {
        return Err(DesktopFailure::conflict());
    }
    let change = match operation {
        "curator.status" => false,
        "curator.pause" => true,
        "curator.run" => {
            return system_actions::request(
                state,
                scope,
                "systemActions.start",
                &json!({"profile": scope.profile, "action": "curator-run"}),
            )
            .await
        }
        "curator.runStatus" => {
            return system_actions::request(
                state,
                scope,
                "systemActions.status",
                &json!({"profile": scope.profile, "action": "curator-run"}),
            )
            .await
        }
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let body = if change {
        Some(
            json!({"paused": payload.get("paused").and_then(Value::as_bool)
            .ok_or_else(DesktopFailure::invalid_input)?}),
        )
    } else {
        None
    };
    scope.ensure_current(state).await?;
    let (port, _, _) = scope.http_auth().await?;
    let endpoint = path(port, &scope.profile, change)?;
    let operation_id = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "curator_request_start operation={operation_id} profile={} action={operation}",
            scope.profile
        ),
    );
    let result = config_request_for_scope(
        state,
        scope,
        if change { Method::PUT } else { Method::GET },
        &endpoint,
        body,
    )
    .await
    .and_then(|value| {
        let valid = if change {
            value.get("ok").and_then(Value::as_bool) == Some(true)
                && value.get("paused").is_some_and(Value::is_boolean)
        } else {
            value.get("enabled").is_some_and(Value::is_boolean)
                && value.get("paused").is_some_and(Value::is_boolean)
        };
        if valid {
            Ok(value)
        } else {
            Err(DesktopFailure::operation_failed())
        }
    });
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "curator_request_{} operation={operation_id} profile={} action={operation}",
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            },
            scope.profile
        ),
    );
    result
}

#[cfg(test)]
#[path = "tests/curator.rs"]
mod tests;
