use super::{config_request_for_scope, write_request, BackendState, ResolvedProfileScope};
use crate::{diagnostics::append_client_event, errors::DesktopFailure};
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

pub(super) const UPDATE_ALL: &str = "/api/dashboard/agent-plugins/update-all";
pub(super) const AUTO_UPDATE: &str = "/api/dashboard/plugins/auto-update";

pub(super) fn auto_update_body(payload: &Value) -> Result<Value, DesktopFailure> {
    let enabled = payload["enabled"]
        .as_bool()
        .ok_or_else(DesktopFailure::invalid_input)?;
    Ok(json!({"enabled": enabled}))
}

pub(super) async fn auto_update(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    let writing = body.is_some();
    let id = Uuid::new_v4();
    let log = |phase| {
        let _ = append_client_event(
            &scope.storage,
            &format!(
                "hermes_plugin_auto_update operation={id} profile={} write={writing} phase={phase}",
                scope.profile
            ),
        );
    };
    log("start");
    let method = if writing { Method::PUT } else { Method::GET };
    let result = config_request_for_scope(state, scope, method, AUTO_UPDATE, body)
        .await
        .and_then(|value| {
            let auto_apply = value["auto_apply"]
                .as_bool()
                .ok_or_else(DesktopFailure::operation_failed)?;
            let check_hours = value["check_hours"]
                .as_f64()
                .ok_or_else(DesktopFailure::operation_failed)?;
            Ok(json!({"auto_apply": auto_apply, "check_hours": check_hours}))
        });
    log(if result.is_ok() {
        "completed"
    } else {
        "failed"
    });
    result
}

pub(super) async fn update_all(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
) -> Result<Value, DesktopFailure> {
    let id = Uuid::new_v4();
    let log = |phase| {
        let _ = append_client_event(
            &scope.storage,
            &format!(
                "hermes_plugin_batch operation={id} profile={} phase={phase}",
                scope.profile
            ),
        );
    };
    log("start");
    let result = write_request(state, scope, Method::POST, UPDATE_ALL, None).await;
    log(if result.is_ok() {
        "completed"
    } else {
        "failed"
    });
    result
}

pub(super) fn project(raw: &Value) -> Result<Value, DesktopFailure> {
    let results = raw["results"]
        .as_array()
        .ok_or_else(DesktopFailure::operation_failed)?;
    let skipped = raw["skipped"]
        .as_array()
        .ok_or_else(DesktopFailure::operation_failed)?;
    let current = raw["current"]
        .as_u64()
        .ok_or_else(DesktopFailure::operation_failed)?;
    let rows = results
        .iter()
        .map(|row| {
            let name = row["name"]
                .as_str()
                .filter(|name| super::valid_plugin_name(name))
                .ok_or_else(DesktopFailure::operation_failed)?;
            let status = match row["status"].as_str() {
                Some(status @ ("updated" | "current" | "failed" | "needs_review")) => status,
                _ => return Err(DesktopFailure::operation_failed()),
            };
            Ok(json!({"name": name, "status": status}))
        })
        .collect::<Result<Vec<_>, DesktopFailure>>()?;
    Ok(json!({"results": rows, "skipped": skipped.len(), "current": current}))
}
