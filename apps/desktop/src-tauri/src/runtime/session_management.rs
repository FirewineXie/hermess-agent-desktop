use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use reqwest::{Method, Url};
use serde_json::{json, Map, Value};
use tauri::State;
use uuid::Uuid;

const AUTOMATION_SOURCES: &str =
    "cron,tool,oneshot,api_server,acp,hermes_flow,vulcan_delegate,webhook";
const NO_MATCHING_SOURCE: &str = "__hermes_dashboard_no_matching_source__";

fn text<'a>(payload: &'a Value, key: &str, max: usize) -> Result<&'a str, DesktopFailure> {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if value.len() > max || value.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn session_id(payload: &Value) -> Result<&str, DesktopFailure> {
    let id = text(payload, "id", 180)?;
    if id.is_empty() || id.contains(['/', '\\', '?', '#']) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(id)
}

fn source_list(payload: &Value, key: &str) -> Result<Option<String>, DesktopFailure> {
    let Some(value) = payload.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let values = value
        .as_array()
        .filter(|values| values.len() <= 64)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if values.is_empty() {
        return Ok(Some(String::new()));
    }
    let mut sources = Vec::with_capacity(values.len());
    for value in values {
        let source = value
            .as_str()
            .map(str::trim)
            .filter(|source| {
                !source.is_empty()
                    && source.len() <= 80
                    && !source.contains(',')
                    && !source.chars().any(char::is_control)
            })
            .ok_or_else(DesktopFailure::invalid_input)?;
        if sources.iter().any(|existing| *existing == source) {
            return Err(DesktopFailure::invalid_input());
        }
        sources.push(source);
    }
    Ok(Some(sources.join(",")))
}

fn url_for_session(id: &str, suffix: Option<&str>) -> Result<Url, DesktopFailure> {
    let mut url = Url::parse("http://127.0.0.1/api/sessions/")
        .map_err(|_| DesktopFailure::operation_failed())?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| DesktopFailure::operation_failed())?;
        segments.pop_if_empty().push(id);
        if let Some(suffix) = suffix {
            segments.push(suffix);
        }
    }
    Ok(url)
}

fn path(url: &Url) -> String {
    format!("{}?{}", url.path(), url.query().unwrap_or_default())
}

fn read_shape(profile: &str, operation: &str, payload: &Value) -> Result<String, DesktopFailure> {
    let mut url = match operation {
        "sessionManagement.list" => Url::parse("http://127.0.0.1/api/sessions")
            .map_err(|_| DesktopFailure::operation_failed())?,
        "sessionManagement.search" => Url::parse("http://127.0.0.1/api/sessions/search")
            .map_err(|_| DesktopFailure::operation_failed())?,
        "sessionManagement.stats" => Url::parse("http://127.0.0.1/api/sessions/stats")
            .map_err(|_| DesktopFailure::operation_failed())?,
        "sessionManagement.emptyCount" => Url::parse("http://127.0.0.1/api/sessions/empty/count")
            .map_err(|_| DesktopFailure::operation_failed())?,
        "sessionManagement.health" => Url::parse("http://127.0.0.1/api/status")
            .map_err(|_| DesktopFailure::operation_failed())?,
        "sessionManagement.messages" => url_for_session(session_id(payload)?, Some("messages"))?,
        _ => return Err(DesktopFailure::invalid_input()),
    };
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("profile", profile);
        match operation {
            "sessionManagement.list" => {
                let limit = payload.get("limit").and_then(Value::as_u64).unwrap_or(25);
                let offset = payload.get("offset").and_then(Value::as_u64).unwrap_or(0);
                if !(1..=100).contains(&limit) || offset > 1_000_000 {
                    return Err(DesktopFailure::invalid_input());
                }
                let archived = text(payload, "archived", 10)?;
                if !["", "exclude", "include", "only"].contains(&archived) {
                    return Err(DesktopFailure::invalid_input());
                }
                query.append_pair("limit", &limit.to_string());
                query.append_pair("offset", &offset.to_string());
                query.append_pair("order", "recent");
                query.append_pair(
                    "archived",
                    if archived.is_empty() {
                        "exclude"
                    } else {
                        archived
                    },
                );
            }
            "sessionManagement.search" => {
                let search = text(payload, "q", 180)?;
                if search.is_empty() {
                    return Err(DesktopFailure::invalid_input());
                }
                query.append_pair("q", search);
                query.append_pair("limit", "100");
            }
            "sessionManagement.messages" => {
                query.append_pair("limit", "500");
                query.append_pair("order", "latest");
                query.append_pair("inline_images", "false");
            }
            _ => {}
        }
        if operation == "sessionManagement.list" || operation == "sessionManagement.search" {
            let category = text(payload, "category", 12)?;
            let source = text(payload, "source", 80)?;
            if source.contains(',') {
                return Err(DesktopFailure::invalid_input());
            }
            let sources = source_list(payload, "sources")?;
            let excluded_sources = source_list(payload, "excludeSources")?;
            let explicit_filter_count = usize::from(!source.is_empty())
                + usize::from(sources.is_some())
                + usize::from(excluded_sources.is_some());
            if explicit_filter_count > 1 {
                return Err(DesktopFailure::invalid_input());
            }
            match category {
                "" | "all" | "chats" | "automation" => {}
                _ => return Err(DesktopFailure::invalid_input()),
            }
            if !source.is_empty() {
                query.append_pair("source", source);
            } else if let Some(sources) = sources {
                query.append_pair(
                    "sources",
                    if sources.is_empty() {
                        NO_MATCHING_SOURCE
                    } else {
                        &sources
                    },
                );
            } else if let Some(excluded_sources) = excluded_sources {
                if excluded_sources.is_empty() {
                    query.append_pair("source", NO_MATCHING_SOURCE);
                } else {
                    query.append_pair("exclude_sources", &excluded_sources);
                }
            } else {
                match category {
                    "chats" => {
                        query.append_pair("exclude_sources", AUTOMATION_SOURCES);
                    }
                    "automation" => {
                        query.append_pair("sources", AUTOMATION_SOURCES);
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(path(&url))
}

fn safe_health_text(value: Option<&Value>, max: usize) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= max
                && value.chars().all(|character| {
                    !character.is_control() || matches!(character, '\n' | '\r' | '\t')
                })
        })
}

fn project_session_health(value: &Value) -> Value {
    let mut platforms = Map::new();
    if let Some(entries) = value.get("gateway_platforms").and_then(Value::as_object) {
        for (key, entry) in entries.iter().take(128) {
            if key.is_empty() || key.len() > 160 || key.chars().any(char::is_control) {
                continue;
            }
            let state = safe_health_text(entry.get("state").or_else(|| entry.get("status")), 40);
            let error_code = safe_health_text(entry.get("error_code"), 80);
            let error_message = safe_health_text(entry.get("error_message"), 2048);
            platforms.insert(
                key.clone(),
                json!({"state":state,"error_code":error_code,"error_message":error_message}),
            );
        }
    }
    json!({
        "gateway_running": value.get("gateway_running").and_then(Value::as_bool).unwrap_or(false),
        "gateway_state": safe_health_text(value.get("gateway_state"), 40),
        "gateway_exit_reason": safe_health_text(value.get("gateway_exit_reason"), 2048),
        "gateway_platforms": platforms,
    })
}

fn rename_shape(
    profile: &str,
    payload: &Value,
    snapshot: &Value,
) -> Result<(String, Value), DesktopFailure> {
    let id = session_id(payload)?;
    let title = text(payload, "title", 200)?;
    if title.is_empty() || snapshot.get("exists").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::invalid_input());
    }
    let revision = snapshot
        .get("runtime_revision")
        .and_then(Value::as_i64)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let generation = snapshot
        .get("runtime_generation")
        .cloned()
        .unwrap_or(Value::Null);
    let body = json!({"title":title,"profile":profile,"request_id":Uuid::new_v4().to_string(),
        "expected_revision":revision,"expected_generation":generation});
    Ok((url_for_session(id, None)?.path().to_string(), body))
}

fn archive_shape(
    profile: &str,
    payload: &Value,
    snapshot: &Value,
) -> Result<(String, Value), DesktopFailure> {
    let id = session_id(payload)?;
    let archived = payload
        .get("archived")
        .and_then(Value::as_bool)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if snapshot.get("exists").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::invalid_input());
    }
    let revision = snapshot
        .get("runtime_revision")
        .and_then(Value::as_i64)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let generation = snapshot
        .get("runtime_generation")
        .cloned()
        .unwrap_or(Value::Null);
    let body = json!({"archived":archived,"profile":profile,"request_id":Uuid::new_v4().to_string(),
        "expected_revision":revision,"expected_generation":generation});
    Ok((url_for_session(id, None)?.path().to_string(), body))
}

fn write_shape(
    profile: &str,
    operation: &str,
    payload: &Value,
) -> Result<(Method, String, Option<Value>), DesktopFailure> {
    match operation {
        "sessionManagement.bulkDelete" => {
            let ids = payload
                .get("ids")
                .and_then(Value::as_array)
                .ok_or_else(DesktopFailure::invalid_input)?;
            if ids.is_empty()
                || ids.len() > 500
                || ids.iter().any(|id| {
                    let value = json!({"id":id});
                    session_id(&value).is_err()
                })
            {
                return Err(DesktopFailure::invalid_input());
            }
            Ok((
                Method::POST,
                "/api/sessions/bulk-delete".into(),
                Some(json!({"ids":ids,"profile":profile})),
            ))
        }
        "sessionManagement.deleteEmpty" => {
            let mut url = Url::parse("http://127.0.0.1/api/sessions/empty")
                .map_err(|_| DesktopFailure::operation_failed())?;
            url.query_pairs_mut().append_pair("profile", profile);
            Ok((Method::DELETE, path(&url), None))
        }
        "sessionManagement.prune" => {
            let days = payload
                .get("days")
                .and_then(Value::as_u64)
                .filter(|value| (1..=36500).contains(value))
                .ok_or_else(DesktopFailure::invalid_input)?;
            let dry_run = payload
                .get("dryRun")
                .and_then(Value::as_bool)
                .ok_or_else(DesktopFailure::invalid_input)?;
            let include_archived = payload
                .get("includeArchived")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Ok((
                Method::POST,
                "/api/sessions/prune".into(),
                Some(json!({
                    "profile":profile,"older_than_days":days,"dry_run":dry_run,"include_archived":include_archived
                })),
            ))
        }
        _ => Err(DesktopFailure::invalid_input()),
    }
}

fn import_shape(
    profile: &str,
    payload: &Value,
    snapshot: &Value,
) -> Result<(String, Value), DesktopFailure> {
    let sessions = payload
        .get("sessions")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if sessions.is_empty()
        || sessions.iter().any(|row| {
            let value = json!({"id":row.get("id")});
            session_id(&value).is_err()
        })
        || serde_json::to_vec(sessions)
            .map_err(|_| DesktopFailure::invalid_input())?
            .len()
            > 24 * 1024 * 1024
    {
        return Err(DesktopFailure::invalid_input());
    }
    let revision = snapshot
        .get("runtime_revision")
        .and_then(Value::as_i64)
        .ok_or_else(DesktopFailure::operation_failed)?;
    Ok((
        "/api/sessions/import".into(),
        json!({"sessions":sessions,"profile":profile,
        "request_id":Uuid::new_v4().to_string(),"expected_revision":revision}),
    ))
}

fn write_log(scope: &ResolvedProfileScope, action: &str, id: &str, phase: &str) {
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "sessions action={action} operation={id} profile={} {phase}",
            scope.profile
        ),
    );
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    if matches!(
        operation,
        "sessionManagement.rename" | "sessionManagement.archive"
    ) {
        let id = session_id(payload)?;
        let url = url_for_session(id, Some("mutation-snapshot"))?;
        let mut snapshot_url = url;
        snapshot_url
            .query_pairs_mut()
            .append_pair("profile", &scope.profile);
        let log_id = Uuid::new_v4().to_string();
        let action = if operation == "sessionManagement.rename" {
            "rename"
        } else if payload.get("archived").and_then(Value::as_bool) == Some(true) {
            "archive"
        } else {
            "restore"
        };
        write_log(scope, action, &log_id, "phase=start");
        let result = async {
            let snapshot =
                config_request_for_scope(state, scope, Method::GET, &path(&snapshot_url), None)
                    .await?;
            let (route, body) = if operation == "sessionManagement.rename" {
                rename_shape(&scope.profile, payload, &snapshot)?
            } else {
                archive_shape(&scope.profile, payload, &snapshot)?
            };
            config_request_for_scope(state, scope, Method::PATCH, &route, Some(body)).await
        }
        .await;
        write_log(
            scope,
            action,
            &log_id,
            if result.is_ok() {
                "status=ok"
            } else {
                "status=failed"
            },
        );
        return result;
    }
    if operation == "sessionManagement.import" {
        let sessions = payload
            .get("sessions")
            .and_then(Value::as_array)
            .ok_or_else(DesktopFailure::invalid_input)?;
        let first = sessions.first().ok_or_else(DesktopFailure::invalid_input)?;
        let anchor = session_id(&json!({"id":first.get("id")}))?.to_string();
        let mut snapshot_url = url_for_session(&anchor, Some("mutation-snapshot"))?;
        snapshot_url
            .query_pairs_mut()
            .append_pair("profile", &scope.profile);
        let log_id = Uuid::new_v4().to_string();
        write_log(scope, "import", &log_id, "phase=start");
        let result = async {
            let snapshot =
                config_request_for_scope(state, scope, Method::GET, &path(&snapshot_url), None)
                    .await?;
            let (route, body) = import_shape(&scope.profile, payload, &snapshot)?;
            config_request_for_scope(state, scope, Method::POST, &route, Some(body)).await
        }
        .await;
        write_log(
            scope,
            "import",
            &log_id,
            if result.is_ok() {
                "status=ok"
            } else {
                "status=failed"
            },
        );
        return result;
    }
    if matches!(
        operation,
        "sessionManagement.bulkDelete"
            | "sessionManagement.deleteEmpty"
            | "sessionManagement.prune"
    ) {
        let (method, route, body) = write_shape(&scope.profile, operation, payload)?;
        let log_id = Uuid::new_v4().to_string();
        write_log(scope, operation, &log_id, "phase=start");
        let result = config_request_for_scope(state, scope, method, &route, body).await;
        write_log(
            scope,
            operation,
            &log_id,
            if result.is_ok() {
                "status=ok"
            } else {
                "status=failed"
            },
        );
        return result;
    }
    let route = read_shape(&scope.profile, operation, payload)?;
    let value = config_request_for_scope(state, scope, Method::GET, &route, None).await?;
    Ok(if operation == "sessionManagement.health" {
        project_session_health(&value)
    } else {
        value
    })
}

#[cfg(test)]
#[path = "tests/session_management.rs"]
mod tests;
