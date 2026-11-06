use super::{
    kanban_dashboard::TASK_CREATE_LOCK, profile_scope::ResolvedProfileScope, BackendState,
};
use crate::errors::DesktopFailure;
use reqwest::{Client, Method};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

const ROOT: &str = "/api/plugins/kanban";
const BOARD: &str = "default";

struct OperationLog {
    id: Uuid,
    action: String,
    storage: PathBuf,
    completed: bool,
}

impl OperationLog {
    fn start(action: &str, storage: PathBuf) -> Self {
        let log = Self {
            id: Uuid::new_v4(),
            action: action.to_owned(),
            storage,
            completed: false,
        };
        let _ = crate::diagnostics::append_client_event(
            &log.storage,
            &format!(
                "personal_task_start operation={} action={}",
                log.id, log.action
            ),
        );
        log
    }

    fn complete(&mut self) {
        self.completed = true;
        let _ = crate::diagnostics::append_client_event(
            &self.storage,
            &format!(
                "personal_task_completed operation={} action={}",
                self.id, self.action
            ),
        );
    }
}

impl Drop for OperationLog {
    fn drop(&mut self) {
        if !self.completed {
            let _ = crate::diagnostics::append_client_event(
                &self.storage,
                &format!(
                    "personal_task_failed operation={} action={}",
                    self.id, self.action
                ),
            );
        }
    }
}

struct KanbanApi<'a> {
    client: Client,
    scope: &'a ResolvedProfileScope,
    state: &'a BackendState,
    operation: Option<Uuid>,
}

impl KanbanApi<'_> {
    fn tenant(&self) -> String {
        format!("hermess-desktop-{}", self.scope.profile)
    }

    async fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        extra: &[(&str, &str)],
    ) -> Result<Value, DesktopFailure> {
        self.scope.ensure_current(self.state).await?;
        let (port, header, credential) = self.scope.http_auth().await?;
        self.scope.ensure_current(self.state).await?;
        let mut url = reqwest::Url::parse(&format!("http://127.0.0.1:{port}{ROOT}{path}"))
            .map_err(|_| DesktopFailure::invalid_input())?;
        url.query_pairs_mut()
            .append_pair("board", BOARD)
            .extend_pairs(extra.iter().copied());
        let mut req = self
            .client
            .request(method, url)
            .timeout(Duration::from_secs(20))
            .header(header, credential);
        if path.ends_with("/decompose") {
            req = req.timeout(Duration::from_secs(210));
        }
        if let Some(body) = body {
            req = req.json(&body);
        }
        let response = req.send().await.map_err(|_| {
            self.log_failure(path, "connection_lost");
            DesktopFailure::connection_lost()
        })?;
        if !response.status().is_success() {
            self.log_failure(path, &format!("http_{}", response.status().as_u16()));
            return Err(match response.status().as_u16() {
                404 => DesktopFailure::runtime_unavailable(),
                400 | 409 | 422 => DesktopFailure::conflict(),
                _ => DesktopFailure::operation_failed(),
            });
        }
        if response
            .content_length()
            .is_some_and(|n| n > 4 * 1024 * 1024)
        {
            return Err(DesktopFailure::operation_failed());
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| DesktopFailure::connection_lost())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(DesktopFailure::operation_failed());
        }
        self.scope.ensure_current(self.state).await?;
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())
    }

    fn log_failure(&self, path: &str, reason: &str) {
        if let Some(operation) = self.operation {
            let _ = crate::diagnostics::append_client_event(&self.scope.storage,
                &format!("personal_task_gateway_failed operation={operation} path={path} reason={reason}"));
        }
    }

    async fn board(&self) -> Result<Value, DesktopFailure> {
        let marker = self.tenant();
        self.call(
            Method::GET,
            "/board",
            None,
            &[("tenant", &marker), ("include_archived", "true")],
        )
        .await
    }

    async fn detail(&self, id: &str) -> Result<Value, DesktopFailure> {
        let raw = self.call(Method::GET, &task_path(id)?, None, &[]).await?;
        ensure_owner(&raw, &self.scope.profile)?;
        Ok(raw)
    }
}

fn ensure_owner(raw: &Value, profile: &str) -> Result<(), DesktopFailure> {
    if raw["task"]["tenant"].as_str() != Some(format!("hermess-desktop-{profile}").as_str()) {
        return Err(DesktopFailure::runtime_unavailable());
    }
    Ok(())
}

fn task_path(id: &str) -> Result<String, DesktopFailure> {
    if id.len() < 8
        || id.len() > 64
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(format!("/tasks/{id}"))
}

fn required<'a>(value: &'a Value, field: &str, max: usize) -> Result<&'a str, DesktopFailure> {
    let text = value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if text.trim().is_empty() || text.len() > max || text.contains('\0') {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(text)
}

fn request_id(value: &Value) -> Result<String, DesktopFailure> {
    Uuid::parse_str(required(value, "request_id", 64)?)
        .map(|id| id.to_string())
        .map_err(|_| DesktopFailure::invalid_input())
}

fn create_body(profile: &str, title: &str, body: &str, key: &str, triage: bool) -> Value {
    json!({"title": title, "body": body, "assignee": profile,
        "tenant": format!("hermess-desktop-{profile}"), "workspace_kind": "scratch",
        "goal_mode": true, "triage": triage, "idempotency_key": key, "max_runtime_seconds": 1800})
}

fn view(task: &Value, profile: &str) -> Value {
    json!({"id": task["id"], "title": task["title"], "body": task["body"],
        "status": task["status"], "profile": profile, "created_at": task["created_at"],
        "result": task["result"], "summary": task["latest_summary"],
        "failure": task["last_failure_error"], "block_kind": task["block_kind"],
        "assignee": task["assignee"], "priority": task["priority"],
        "progress": task["progress"], "link_counts": task["link_counts"]})
}

fn detail_view(mut raw: Value, profile: &str) -> Value {
    if let Some(comments) = raw["comments"].as_array_mut() {
        for comment in comments {
            if comment["author"]
                .as_str()
                .is_some_and(|name| name.starts_with("hermess-user:"))
            {
                comment["author"] = json!("user");
            }
        }
    }
    let mut task = view(&raw["task"], profile);
    if let Some(children) = raw["child_results"].as_array() {
        if !children.is_empty() {
            task["progress"] = json!({"done": children.iter().filter(|child| child["status"] == "done").count(),
                "total": children.len()});
        }
    }
    json!({"task": task, "comments": raw["comments"],
        "events": raw["events"], "attachments": raw["attachments"],
        "links": raw["links"], "link_tasks": raw["link_tasks"],
        "child_results": raw["child_results"]})
}

#[tauri::command]
pub async fn personal_task_request(
    state: State<'_, BackendState>,
    profile: String,
    action: String,
    payload: Value,
) -> Result<Value, DesktopFailure> {
    if !matches!(
        action.as_str(),
        "capabilities"
            | "list"
            | "create"
            | "detail"
            | "decompose"
            | "reply"
            | "resume"
            | "archive"
            | "events"
    ) || !payload.is_object()
    {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let mut operation = matches!(
        action.as_str(),
        "create" | "decompose" | "reply" | "resume" | "archive"
    )
    .then(|| OperationLog::start(&action, scope.storage.clone()));
    let api = KanbanApi {
        client: super::local_http::client()?.clone(),
        scope: &scope,
        state: &state,
        operation: operation.as_ref().map(|log| log.id),
    };
    let result = match action.as_str() {
        "capabilities" => {
            api.board().await?;
            json!({"version": 1})
        }
        "list" | "events" => {
            let board = api.board().await?;
            let cards: Vec<Value> = board["columns"]
                .as_array()
                .ok_or_else(DesktopFailure::operation_failed)?
                .iter()
                .flat_map(|column| column["tasks"].as_array().into_iter().flatten().cloned())
                .collect();
            if action == "list" {
                json!({"tasks": cards.iter().map(|card| view(card, &scope.profile)).collect::<Vec<_>>()})
            } else {
                let after = payload["after"]
                    .as_u64()
                    .ok_or_else(DesktopFailure::invalid_input)?;
                let latest = board["latest_event_id"]
                    .as_u64()
                    .ok_or_else(DesktopFailure::operation_failed)?;
                let mut events = Vec::new();
                if latest > after {
                    for card in cards {
                        let id = card["id"]
                            .as_str()
                            .ok_or_else(DesktopFailure::operation_failed)?;
                        let detail = api.detail(id).await?;
                        for event in detail["events"]
                            .as_array()
                            .ok_or_else(DesktopFailure::operation_failed)?
                        {
                            if event["id"]
                                .as_u64()
                                .is_some_and(|event_id| event_id > after)
                            {
                                events.push(json!({"id": event["id"], "task_id": id, "kind": event["kind"], "created_at": event["created_at"]}));
                            }
                        }
                    }
                }
                events.sort_by_key(|event| event["id"].as_u64().unwrap_or(0));
                json!({"events": events, "next": latest})
            }
        }
        "create" => {
            let _create_guard = TASK_CREATE_LOCK.lock().await;
            scope.ensure_current(&state).await?;
            let title = required(&payload, "title", 200)?;
            let body = required(&payload, "body", 20000)?;
            let key = request_id(&payload)?;
            let triage = payload["triage"].as_bool().unwrap_or(false);
            let created = api
                .call(
                    Method::POST,
                    "/tasks",
                    Some(create_body(&scope.profile, title, body, &key, triage)),
                    &[],
                )
                .await?;
            let id = created["task"]["id"]
                .as_str()
                .ok_or_else(DesktopFailure::operation_failed)?;
            detail_view(api.detail(id).await?, &scope.profile)
        }
        "decompose" => {
            let id = required(&payload, "task_id", 64)?;
            let before = api.detail(id).await?;
            if before["task"]["status"] != "triage" {
                return Err(DesktopFailure::conflict());
            }
            let path = format!("{}/decompose", task_path(id)?);
            let outcome = api.call(Method::POST, &path, Some(json!({})), &[]).await?;
            json!({"ok": outcome["ok"], "reason": outcome["reason"],
                "detail": detail_view(api.detail(id).await?, &scope.profile)})
        }
        "detail" | "reply" | "resume" | "archive" => {
            let id = required(&payload, "task_id", 64)?;
            let path = task_path(id)?;
            let before = api.detail(id).await?;
            match action.as_str() {
                "reply" => {
                    let body = required(&payload, "body", 20000)?;
                    let author = format!("hermess-user:{}", request_id(&payload)?);
                    let prior = before["comments"].as_array().and_then(|rows| {
                        rows.iter()
                            .find(|row| row["author"].as_str() == Some(&author))
                    });
                    if prior.is_some_and(|row| row["body"].as_str() != Some(body)) {
                        return Err(DesktopFailure::conflict());
                    }
                    let present = prior.is_some();
                    if !present {
                        if before["task"]["status"] != "blocked" {
                            return Err(DesktopFailure::conflict());
                        }
                        api.call(
                            Method::POST,
                            &format!("{path}/comments"),
                            Some(json!({"body": body, "author": author})),
                            &[],
                        )
                        .await?;
                    }
                }
                "resume" => {
                    request_id(&payload)?;
                    if matches!(
                        before["task"]["status"].as_str(),
                        Some("blocked" | "scheduled")
                    ) {
                        api.call(Method::PATCH, &path, Some(json!({"status": "ready"})), &[])
                            .await?;
                    }
                }
                "archive" => {
                    if before["task"]["status"] != "archived" {
                        api.call(
                            Method::PATCH,
                            &path,
                            Some(json!({"status": "archived"})),
                            &[],
                        )
                        .await?;
                    }
                }
                _ => {}
            }
            detail_view(api.detail(id).await?, &scope.profile)
        }
        _ => unreachable!(),
    };
    scope.ensure_current(&state).await?;
    if action == "decompose" && result["ok"] == false {
        return Ok(result);
    }
    if let Some(log) = operation.as_mut() {
        log.complete();
    }
    Ok(result)
}

#[cfg(test)]
#[path = "tests/personal_tasks.rs"]
mod tests;
