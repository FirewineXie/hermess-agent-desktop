use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::{Method, Url};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

// Dashboard cron routes accept an explicit Profile. Gateway cron.manage still
// handles pause/resume while the Dashboard handles the full create/update form.

fn field<'a>(payload: &'a Value, key: &str, max: usize) -> Result<&'a str, DesktopFailure> {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn job_id(payload: &Value) -> Result<&str, DesktopFailure> {
    let id = field(payload, "id", 12)?;
    if id.len() != 12 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(id)
}

fn optional_text(payload: &Value, key: &str, max: usize) -> Result<Option<String>, DesktopFailure> {
    let value = payload.get(key).filter(|value| !value.is_null());
    let text = value.and_then(Value::as_str).unwrap_or("").trim();
    if value.is_some_and(|value| !value.is_string())
        || text.len() > max
        || text
            .chars()
            .any(|c| c == '\0' || key != "prompt" && c.is_control())
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok((!text.is_empty()).then(|| text.to_owned()))
}

fn string_list(payload: &Value, key: &str) -> Result<Option<Vec<String>>, DesktopFailure> {
    let Some(value) = payload.get(key).filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let items = value.as_array().ok_or_else(DesktopFailure::invalid_input)?;
    if items.len() > 100 {
        return Err(DesktopFailure::invalid_input());
    }
    let mut result = Vec::with_capacity(items.len());
    for item in items {
        let text = item
            .as_str()
            .ok_or_else(DesktopFailure::invalid_input)?
            .trim();
        if text.is_empty() || text.len() > 200 || text.chars().any(char::is_control) {
            return Err(DesktopFailure::invalid_input());
        }
        result.push(text.to_owned());
    }
    Ok(Some(result))
}

fn cron_mutation(payload: &Value, create: bool) -> Result<Value, DesktopFailure> {
    let schedule = field(payload, "schedule", 200)?;
    let name = optional_text(payload, "name", 100)?.unwrap_or_default();
    let prompt = optional_text(payload, "prompt", 20_000)?.unwrap_or_default();
    let script = optional_text(payload, "script", 4096)?;
    let skills = string_list(payload, "skills")?.unwrap_or_default();
    let no_agent = payload
        .get("no_agent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if prompt.is_empty() && script.is_none() && skills.is_empty() || no_agent && script.is_none() {
        return Err(DesktopFailure::invalid_input());
    }
    let context_from = string_list(payload, "context_from")?;
    let toolsets = string_list(payload, "enabled_toolsets")?;
    let repeat = payload.get("repeat").filter(|value| !value.is_null());
    if repeat.is_some_and(|value| {
        !value
            .as_u64()
            .is_some_and(|number| number > 0 && number <= 10_000)
            && !value
                .as_str()
                .is_some_and(|text| !text.is_empty() && text.len() <= 20)
    }) {
        return Err(DesktopFailure::invalid_input());
    }
    let paused = payload
        .get("paused")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut body = json!({
        "name": name,
        "schedule": schedule,
        "prompt": prompt,
        "deliver": optional_text(payload, "deliver", 100)?.unwrap_or_else(|| "local".into()),
        "skills": skills,
        "provider": optional_text(payload, "provider", 100)?,
        "model": optional_text(payload, "model", 200)?,
        "base_url": optional_text(payload, "base_url", 2048)?,
        "script": script,
        "no_agent": no_agent,
        "context_from": context_from,
        "enabled_toolsets": toolsets,
        "workdir": optional_text(payload, "workdir", 4096)?,
        "repeat": repeat,
        "paused": paused,
    });
    if !create {
        body.as_object_mut().unwrap().remove("repeat");
        body.as_object_mut().unwrap().remove("paused");
    }
    Ok(body)
}

fn gateway_job_result(result: Value) -> Result<Value, DesktopFailure> {
    if result.get("success").and_then(Value::as_bool) == Some(true) {
        return Ok(json!({"job":result.get("job")}));
    }
    Err(DesktopFailure::operation_failed())
}

fn partial_create_response(value: &Value) -> Option<Value> {
    let detail = value.get("detail")?;
    (detail.get("job_saved")?.as_bool()?
        && !detail.get("retry_create")?.as_bool()?
        && detail.get("job_id")?.as_str().is_some())
    .then(|| json!({"job_saved":true,"scheduler_registered":false,"job_id":detail["job_id"]}))
}

fn cron_job_url(
    port: u16,
    profile: &str,
    id: Option<&str>,
    suffix: Option<&str>,
) -> Result<Url, DesktopFailure> {
    let mut url = Url::parse(&format!("http://127.0.0.1:{port}/api/cron/jobs"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if let Some(id) = id {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| DesktopFailure::operation_failed())?;
        segments.push(id);
        if let Some(suffix) = suffix {
            segments.push(suffix);
        }
    }
    url.query_pairs_mut().append_pair("profile", profile);
    Ok(url)
}

async fn dashboard_request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    method: Method,
    id: Option<&str>,
    suffix: Option<&str>,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let (port, _, _) = scope.http_auth().await?;
    scope.ensure_current(state).await?;
    let url = cron_job_url(port, &scope.profile, id, suffix)?;
    dashboard_request_url(state, scope, method, url, body, id.is_none()).await
}

async fn dashboard_request_url(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    method: Method,
    url: Url,
    body: Option<Value>,
    root_create: bool,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let (_, auth_header, token) = scope.http_auth().await?;
    let creating = method == Method::POST && root_create;
    let mut request = super::local_http::client()?
        .request(method, url)
        .timeout(Duration::from_secs(45))
        .header(auth_header, token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|size| size > 4 * 1024 * 1024)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(DesktopFailure::operation_failed());
        }
        bytes.extend_from_slice(&chunk);
    }
    scope.ensure_current(state).await?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    if status.is_success() {
        Ok(value)
    } else if creating && status.as_u16() == 424 {
        partial_create_response(&value).ok_or_else(DesktopFailure::operation_failed)
    } else {
        Err(DesktopFailure::operation_failed())
    }
}

fn blueprint_url(port: u16, profile: &str, instantiate: bool) -> Result<Url, DesktopFailure> {
    let mut url = Url::parse(&format!(
        "http://127.0.0.1:{port}/api/cron/blueprints{}",
        if instantiate { "/instantiate" } else { "" }
    ))
    .map_err(|_| DesktopFailure::operation_failed())?;
    url.query_pairs_mut().append_pair("profile", profile);
    Ok(url)
}

fn blueprint_payload(payload: &Value) -> Result<Value, DesktopFailure> {
    let blueprint = field(payload, "blueprint", 200)?;
    let values = payload
        .get("values")
        .and_then(Value::as_object)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if values.len() > 50 {
        return Err(DesktopFailure::invalid_input());
    }
    let mut cleaned = serde_json::Map::new();
    for (key, value) in values {
        if key.is_empty() || key.len() > 100 || key.chars().any(char::is_control) {
            return Err(DesktopFailure::invalid_input());
        }
        let text = value.as_str().ok_or_else(DesktopFailure::invalid_input)?;
        if text.len() > 4096 || text.chars().any(|c| c == '\0') {
            return Err(DesktopFailure::invalid_input());
        }
        cleaned.insert(key.clone(), Value::String(text.to_owned()));
    }
    Ok(json!({"blueprint":blueprint,"values":cleaned}))
}

async fn owned_job(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    id: &str,
) -> Result<(), DesktopFailure> {
    // Dashboard's per-ID routes search other Profiles when the supplied Profile
    // does not contain the ID. Check the selected Profile's list before mutating.
    let jobs = dashboard_request(state, scope, Method::GET, None, None, None).await?;
    if jobs.as_array().is_some_and(|jobs| {
        jobs.iter().any(|job| {
            job.get("id").and_then(Value::as_str) == Some(id)
                && job.get("profile").and_then(Value::as_str) == Some(scope.profile.as_str())
        })
    }) {
        Ok(())
    } else {
        Err(DesktopFailure::invalid_input())
    }
}

async fn trigger_request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    id: &str,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let (port, auth_header, token) = scope.http_auth().await?;
    scope.ensure_current(state).await?;
    let url = cron_job_url(port, &scope.profile, Some(id), Some("trigger"))?;
    // The receiver answers after execution. Do not apply the short timeout
    // used by list and detail reads; the UI keeps this one action pending.
    let mut response = super::local_http::client()?
        .post(url)
        .header(auth_header, token)
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|size| size > 1024 * 1024)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err(DesktopFailure::operation_failed());
        }
        bytes.extend_from_slice(&chunk);
    }
    scope.ensure_current(state).await?;
    if status.as_u16() == 409 {
        return Err(DesktopFailure::conflict());
    }
    if !status.is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    let job: Value =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    if job.get("id").and_then(Value::as_str) != Some(id)
        || job.get("profile").and_then(Value::as_str) != Some(scope.profile.as_str())
    {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(job)
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
        .is_some_and(|owner| owner != scope.profile)
    {
        return Err(DesktopFailure::conflict());
    }
    match operation {
        "jobs.blueprints" => {
            scope.ensure_current(state).await?;
            let (port, _, _) = scope.http_auth().await?;
            let url = blueprint_url(port, &scope.profile, false)?;
            let result = dashboard_request_url(state, scope, Method::GET, url, None, false).await?;
            if !result.get("blueprints").is_some_and(Value::is_array) {
                return Err(DesktopFailure::operation_failed());
            }
            Ok(result)
        }
        "jobs.blueprints.instantiate" => {
            let body = blueprint_payload(payload)?;
            let operation_id = Uuid::new_v4();
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_blueprint operation={operation_id} profile={} phase=start",
                    scope.profile
                ),
            );
            let result = async {
                scope.ensure_current(state).await?;
                let (port, _, _) = scope.http_auth().await?;
                let url = blueprint_url(port, &scope.profile, true)?;
                let value =
                    dashboard_request_url(state, scope, Method::POST, url, Some(body), true)
                        .await?;
                if value.get("job_saved").and_then(Value::as_bool) == Some(true)
                    || value.get("id").and_then(Value::as_str).is_some()
                        && value.get("profile").and_then(Value::as_str)
                            == Some(scope.profile.as_str())
                {
                    Ok(value)
                } else {
                    Err(DesktopFailure::operation_failed())
                }
            }
            .await;
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_blueprint operation={operation_id} profile={} status={}",
                    scope.profile,
                    if result.is_ok() { "ok" } else { "failed" }
                ),
            );
            result
        }
        "jobs.delivery.targets" => {
            let targets = config_request_for_scope(
                state,
                scope,
                Method::GET,
                &format!("/api/cron/delivery-targets?profile={}", scope.profile),
                None,
            )
            .await?;
            if !targets.get("targets").is_some_and(Value::is_array) {
                return Err(DesktopFailure::operation_failed());
            }
            Ok(targets)
        }
        "jobs.list" => {
            let jobs = dashboard_request(state, scope, Method::GET, None, None, None).await?;
            if !jobs.is_array() {
                return Err(DesktopFailure::operation_failed());
            }
            Ok(json!({"jobs": jobs}))
        }
        "jobs.run" => {
            let id = job_id(payload)?;
            let operation_id = Uuid::new_v4();
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_trigger operation={operation_id} profile={} phase=start",
                    scope.profile
                ),
            );
            let result = async {
                owned_job(state, scope, id).await?;
                trigger_request(state, scope, id)
                    .await
                    .map(|job| json!({"job":job}))
            }
            .await;
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_trigger operation={operation_id} profile={} status={}",
                    scope.profile,
                    if result.is_ok() { "ok" } else { "failed" }
                ),
            );
            result
        }
        "jobs.detail" => {
            let id = job_id(payload)?;
            owned_job(state, scope, id).await?;
            let job = dashboard_request(state, scope, Method::GET, Some(id), None, None).await?;
            if job.get("id").and_then(Value::as_str) != Some(id)
                || job.get("profile").and_then(Value::as_str) != Some(scope.profile.as_str())
            {
                return Err(DesktopFailure::invalid_input());
            }
            Ok(json!({"job": job}))
        }
        "jobs.runs" => {
            let id = job_id(payload)?;
            owned_job(state, scope, id).await?;
            let runs =
                dashboard_request(state, scope, Method::GET, Some(id), Some("runs"), None).await?;
            if !runs.get("runs").is_some_and(Value::is_array) {
                return Err(DesktopFailure::operation_failed());
            }
            Ok(runs)
        }
        "jobs.delete" => {
            let id = job_id(payload)?;
            let operation_id = Uuid::new_v4();
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_delete operation={operation_id} profile={} phase=start",
                    scope.profile
                ),
            );
            let result = async {
                owned_job(state, scope, id).await?;
                let result =
                    dashboard_request(state, scope, Method::DELETE, Some(id), None, None).await?;
                if result.get("ok").and_then(Value::as_bool) != Some(true) {
                    return Err(DesktopFailure::operation_failed());
                }
                Ok(result)
            }
            .await;
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_delete operation={operation_id} profile={} status={}",
                    scope.profile,
                    if result.is_ok() { "ok" } else { "failed" }
                ),
            );
            result
        }
        "jobs.update" => {
            let id = job_id(payload)?;
            let updates = cron_mutation(payload, false)?;
            let operation_id = Uuid::new_v4();
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_update operation={operation_id} profile={} phase=start",
                    scope.profile
                ),
            );
            let result = async {
                owned_job(state, scope, id).await?;
                let job = dashboard_request(
                    state,
                    scope,
                    Method::PUT,
                    Some(id),
                    None,
                    Some(json!({"updates": updates})),
                )
                .await?;
                if job.get("id").and_then(Value::as_str) != Some(id)
                    || job.get("profile").and_then(Value::as_str) != Some(scope.profile.as_str())
                {
                    return Err(DesktopFailure::invalid_input());
                }
                Ok(json!({"job": job}))
            }
            .await;
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_update operation={operation_id} profile={} status={}",
                    scope.profile,
                    if result.is_ok() { "ok" } else { "failed" }
                ),
            );
            result
        }
        "jobs.create" => {
            let body = cron_mutation(payload, true)?;
            let operation_id = Uuid::new_v4();
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_create operation={operation_id} profile={} phase=start",
                    scope.profile
                ),
            );
            let result =
                dashboard_request(state, scope, Method::POST, None, None, Some(body)).await;
            let result = result.and_then(|value| {
                if value.get("job_saved").and_then(Value::as_bool) == Some(true) {
                    Ok(value)
                } else if value.get("id").and_then(Value::as_str).is_some()
                    && value.get("profile").and_then(Value::as_str) == Some(scope.profile.as_str())
                {
                    Ok(json!({"job":value}))
                } else {
                    Err(DesktopFailure::operation_failed())
                }
            });
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "cron_create operation={operation_id} profile={} status={}",
                    scope.profile,
                    if result.is_ok() { "ok" } else { "failed" }
                ),
            );
            result
        }
        "jobs.pause" | "jobs.resume" => {
            scope.ensure_current(state).await?;
            let params = json!({"action": if operation == "jobs.pause" { "pause" } else { "resume" },
                "name":job_id(payload)?});
            let result = scope.gateway.request("cron.manage", params).await?;
            scope.ensure_current(state).await?;
            gateway_job_result(result)
        }
        _ => Err(DesktopFailure::invalid_input()),
    }
}

#[cfg(test)]
#[path = "tests/jobs.rs"]
mod tests;
