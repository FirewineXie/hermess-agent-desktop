use super::{profile_scope::ResolvedProfileScope, BackendState};
use crate::{diagnostics::append_client_event, errors::DesktopFailure};
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

fn daybreak_params(
    operation: &str,
    payload: &Value,
) -> Result<(&'static str, Value), DesktopFailure> {
    match operation {
        "daybreak.status" => Ok(("config.get", json!({"key":"daybreak"}))),
        "daybreak.set" => {
            let value = payload["enabled"]
                .as_bool()
                .ok_or_else(DesktopFailure::invalid_input)?;
            Ok(("config.set", json!({"key":"daybreak", "value":value})))
        }
        _ => Err(DesktopFailure::invalid_input()),
    }
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let (method, params) = daybreak_params(operation, payload)?;
    let id = Uuid::new_v4();
    let log = |phase| {
        let _ = append_client_event(
            &scope.storage,
            &format!(
                "daybreak operation={id} profile={} action={operation} phase={phase}",
                scope.profile
            ),
        );
    };
    log("start");
    let result = async {
        scope.ensure_current(state).await?;
        let value = scope
            .gateway
            .request(method, params)
            .await
            .map_err(DesktopFailure::from)?;
        scope.ensure_current(state).await?;
        let enabled = value["value"]
            .as_bool()
            .ok_or_else(DesktopFailure::operation_failed)?;
        Ok(json!({"enabled": enabled}))
    }
    .await;
    log(if result.is_ok() {
        "completed"
    } else {
        "failed"
    });
    result
}

#[cfg(test)]
#[path = "tests/daybreak.rs"]
mod tests;
