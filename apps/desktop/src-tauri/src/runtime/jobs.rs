use super::{profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::{Method, Url};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

// Dashboard cron routes accept an explicit Profile. Gateway cron.manage still
// handles create/pause/resume and preserves its partial-registration result.

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

fn job_prompt(payload: &Value) -> Result<&str, DesktopFailure> {
    let prompt = payload
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if prompt.is_empty() || prompt.len() > 20_000 || prompt.chars().any(|c| c == '\0') {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(prompt)
}

fn gateway_job_result(operation: &str, result: Value) -> Result<Value, DesktopFailure> {
    if result.get("success").and_then(Value::as_bool) == Some(true) {
        return Ok(json!({"job":result.get("job")}));
    }
    if operation == "jobs.create"
        && result.get("job_saved").and_then(Value::as_bool) == Some(true)
        && result.get("retry_create").and_then(Value::as_bool) == Some(false)
        && result.get("job_id").and_then(Value::as_str).is_some()
    {
        return Ok(
            json!({"job_saved":true,"scheduler_registered":false,"job_id":result["job_id"]}),
        );
    }
    Err(DesktopFailure::operation_failed())
}

async fn dashboard_request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    method: Method,
    id: Option<&str>,
    body: Option<Value>,
) -> Result<Value, DesktopFailure> {
    scope.ensure_current(state).await?;
    let (port, auth_header, token) = scope.http_auth().await?;
    scope.ensure_current(state).await?;
    let mut url = Url::parse(&format!("http://127.0.0.1:{port}/api/cron/jobs"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if let Some(id) = id {
        url.path_segments_mut()
            .map_err(|_| DesktopFailure::operation_failed())?
            .push(id);
    }
    url.query_pairs_mut().append_pair("profile", &scope.profile);
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut request = client.request(method, url).header(auth_header, token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !response.status().is_success()
        || response
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
    serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())
}

async fn owned_job(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    id: &str,
) -> Result<(), DesktopFailure> {
    // Dashboard's per-ID routes search other Profiles when the supplied Profile
    // does not contain the ID. Check the selected Profile's list before mutating.
    let jobs = dashboard_request(state, scope, Method::GET, None, None).await?;
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
) -> Result<(), DesktopFailure> {
    scope.ensure_current(state).await?;
    let (port, auth_header, token) = scope.http_auth().await?;
    scope.ensure_current(state).await?;
    let mut url = Url::parse(&format!("http://127.0.0.1:{port}/api/cron/jobs"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    url.path_segments_mut()
        .map_err(|_| DesktopFailure::operation_failed())?
        .push(id)
        .push("trigger");
    url.query_pairs_mut().append_pair("profile", &scope.profile);
    // This endpoint answers after the job finishes. Keep that wait off the UI
    // request and do not apply the 45-second timeout used by ordinary reads.
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| DesktopFailure::operation_failed())?;
    tokio::spawn(async move {
        match client.post(url).header(auth_header, token).send().await {
            Ok(response) if response.status().is_success() => {}
            Ok(response) => eprintln!("Cron trigger failed: HTTP {}", response.status()),
            Err(error) => eprintln!("Cron trigger request failed: {error}"),
        }
    });
    Ok(())
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
        "jobs.list" => {
            let jobs = dashboard_request(state, scope, Method::GET, None, None).await?;
            if !jobs.is_array() {
                return Err(DesktopFailure::operation_failed());
            }
            Ok(json!({"jobs": jobs}))
        }
        "jobs.run" => {
            let id = job_id(payload)?;
            owned_job(state, scope, id).await?;
            trigger_request(state, scope, id).await?;
            Ok(json!({"request_started": true}))
        }
        "jobs.detail" => {
            let id = job_id(payload)?;
            owned_job(state, scope, id).await?;
            let job = dashboard_request(state, scope, Method::GET, Some(id), None).await?;
            if job.get("id").and_then(Value::as_str) != Some(id)
                || job.get("profile").and_then(Value::as_str) != Some(scope.profile.as_str())
            {
                return Err(DesktopFailure::invalid_input());
            }
            Ok(json!({"job": job}))
        }
        "jobs.update" => {
            let id = job_id(payload)?;
            owned_job(state, scope, id).await?;
            let updates = json!({
                "name": field(payload, "name", 100)?,
                "schedule": field(payload, "schedule", 200)?,
                "prompt": job_prompt(payload)?,
            });
            let job = dashboard_request(
                state,
                scope,
                Method::PUT,
                Some(id),
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
        "jobs.create" | "jobs.pause" | "jobs.resume" => {
            scope.ensure_current(state).await?;
            let params = if operation == "jobs.create" {
                json!({"action":"add", "name":field(payload, "name", 100)?,
                    "schedule":field(payload, "schedule", 200)?,
                    "prompt":job_prompt(payload)?, "deliver":"local"})
            } else {
                json!({"action": if operation == "jobs.pause" { "pause" } else { "resume" },
                    "name":job_id(payload)?})
            };
            let result = scope.gateway.request("cron.manage", params).await?;
            scope.ensure_current(state).await?;
            gateway_job_result(operation, result)
        }
        _ => Err(DesktopFailure::invalid_input()),
    }
}

#[cfg(test)]
#[path = "tests/jobs.rs"]
mod tests;
