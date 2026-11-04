use super::BackendState;
use crate::errors::DesktopFailure;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use reqwest::{multipart, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};
use uuid::Uuid;

const API_ROOT: &str = "/api/plugins/kanban";
const TASKS_ROUTE: &str = "/api/plugins/kanban/tasks";
const MAX_UPLOAD: usize = 20 * 1024 * 1024;
const MAX_RESPONSE: usize = 32 * 1024 * 1024;
pub(super) static TASK_CREATE_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Default)]
pub struct KanbanEventStreams(Mutex<HashMap<String, oneshot::Sender<()>>>);

#[derive(Clone, Serialize)]
struct KanbanEventMessage {
    subscription: String,
    board: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    events: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

#[derive(Deserialize)]
pub struct KanbanUpload {
    filename: String,
    content_type: String,
    data_base64: String,
}

fn valid_route(path: &str) -> bool {
    let route = path.split('?').next().unwrap_or("");
    (route == API_ROOT || route.starts_with(&format!("{API_ROOT}/")))
        && !path.contains("..")
        && !path.contains('\\')
        && !path.contains('#')
        && !path.contains('\0')
        && path.len() <= 2048
}

fn valid_board(board: &str) -> bool {
    !board.is_empty()
        && board.len() <= 64
        && board.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'-' | b'_'))
        })
}

fn is_task_create(method: &Method, path: &str) -> bool {
    *method == Method::POST && path.split('?').next() == Some(TASKS_ROUTE)
}

fn event_request(
    port: u16,
    header: &str,
    credential: &str,
    board: &str,
    since: u64,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, DesktopFailure> {
    if !valid_board(board) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut url = reqwest::Url::parse(&format!("ws://127.0.0.1:{port}{API_ROOT}/events"))
        .map_err(|_| DesktopFailure::invalid_input())?;
    url.query_pairs_mut()
        .append_pair("board", board)
        .append_pair("since", &since.to_string());
    if header == "X-Hermes-Session-Token" {
        url.query_pairs_mut().append_pair("token", credential);
    }
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| DesktopFailure::invalid_input())?;
    if header == "X-Hermes-Gateway-Ticket" {
        request.headers_mut().insert(
            "X-Hermes-Gateway-Ticket",
            HeaderValue::from_str(credential).map_err(|_| DesktopFailure::invalid_input())?,
        );
    }
    Ok(request)
}

fn log_event_stream(storage: &std::path::Path, subscription: &str, phase: &str, status: &str) {
    let _ = crate::diagnostics::append_client_event(
        storage,
        &format!("kanban_events subscription={subscription} phase={phase} status={status}"),
    );
}

#[tauri::command]
pub async fn kanban_dashboard_subscribe(
    state: State<'_, BackendState>,
    streams: State<'_, KanbanEventStreams>,
    app: AppHandle,
    subscription: String,
    board: String,
    since: u64,
) -> Result<(), DesktopFailure> {
    Uuid::parse_str(&subscription).map_err(|_| DesktopFailure::invalid_input())?;
    if !valid_board(&board) {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile("default").await?;
    scope.ensure_current(&state).await?;
    let (port, header, credential) = scope.http_auth().await?;
    let request = event_request(port, header, &credential, &board, since)?;
    log_event_stream(&scope.storage, &subscription, "start", "connecting");
    let (socket, _) = timeout(Duration::from_secs(10), connect_async(request))
        .await
        .map_err(|_| {
            log_event_stream(&scope.storage, &subscription, "finish", "timeout");
            DesktopFailure::connection_lost()
        })?
        .map_err(|_| {
            log_event_stream(
                &scope.storage,
                &subscription,
                "finish",
                "connection_rejected",
            );
            DesktopFailure::connection_lost()
        })?;
    scope.ensure_current(&state).await?;
    let (stop_sender, mut stop_receiver) = oneshot::channel();
    if let Some(previous) = streams
        .0
        .lock()
        .await
        .insert(subscription.clone(), stop_sender)
    {
        let _ = previous.send(());
    }
    log_event_stream(&scope.storage, &subscription, "connected", "ok");
    let task_app = app.clone();
    let task_subscription = subscription.clone();
    let task_board = board.clone();
    let storage = scope.storage.clone();
    tokio::spawn(async move {
        let mut socket = socket;
        let mut close_reason = "ended";
        loop {
            tokio::select! {
                _ = &mut stop_receiver => break,
                frame = socket.next() => {
                    match frame {
                        Some(Ok(Message::Text(text))) => {
                            let parsed: Value = match serde_json::from_str(&text) {
                                Ok(value) => value,
                                Err(_) => { close_reason = "invalid_frame"; break; }
                            };
                            let Some(cursor) = parsed.get("cursor").and_then(Value::as_u64) else {
                                close_reason = "invalid_frame";
                                break;
                            };
                            let Some(events) = parsed.get("events").and_then(Value::as_array) else {
                                close_reason = "invalid_frame";
                                break;
                            };
                            if task_app.emit("kanban-dashboard-event", KanbanEventMessage {
                                subscription: task_subscription.clone(), board: task_board.clone(), kind: "frame",
                                cursor: Some(cursor), events: Some(events.clone()), reason: None,
                            }).is_err() { break; }
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            if socket.send(Message::Pong(payload)).await.is_err() {
                                close_reason = "read_failed";
                                break;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Err(_)) => { close_reason = "read_failed"; break; }
                        _ => {}
                    }
                }
            }
        }
        let _ = task_app.emit(
            "kanban-dashboard-event",
            KanbanEventMessage {
                subscription: task_subscription.clone(),
                board: task_board,
                kind: "closed",
                cursor: None,
                events: None,
                reason: Some(close_reason),
            },
        );
        task_app
            .state::<KanbanEventStreams>()
            .0
            .lock()
            .await
            .remove(&task_subscription);
        log_event_stream(&storage, &task_subscription, "finish", close_reason);
    });
    Ok(())
}

#[tauri::command]
pub async fn kanban_dashboard_unsubscribe(
    streams: State<'_, KanbanEventStreams>,
    subscription: String,
) -> Result<(), DesktopFailure> {
    Uuid::parse_str(&subscription).map_err(|_| DesktopFailure::invalid_input())?;
    if let Some(sender) = streams.0.lock().await.remove(&subscription) {
        let _ = sender.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn kanban_dashboard_request(
    state: State<'_, BackendState>,
    path: String,
    method: String,
    body: Option<Value>,
    upload: Option<KanbanUpload>,
) -> Result<Value, DesktopFailure> {
    if !valid_route(&path) {
        return Err(DesktopFailure::invalid_input());
    }
    let method =
        Method::from_bytes(method.as_bytes()).map_err(|_| DesktopFailure::invalid_input())?;
    if !matches!(
        method,
        Method::GET | Method::POST | Method::PATCH | Method::PUT | Method::DELETE
    ) || (upload.is_some() && method != Method::POST)
        || (body.is_some() && upload.is_some())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let serialize_create = is_task_create(&method, &path);
    let _create_guard = if serialize_create {
        Some(TASK_CREATE_LOCK.lock().await)
    } else {
        None
    };

    let scope = state.resolve_profile("default").await?;
    scope.ensure_current(&state).await?;
    let (port, header, credential) = scope.http_auth().await?;
    let url = reqwest::Url::parse(&format!("http://127.0.0.1:{port}{path}"))
        .map_err(|_| DesktopFailure::invalid_input())?;
    if !url.path().starts_with(API_ROOT) || url.host_str() != Some("127.0.0.1") {
        return Err(DesktopFailure::invalid_input());
    }
    let mut request = super::local_http::client()?
        .request(method.clone(), url)
        .timeout(Duration::from_secs(210))
        .header(header, credential);
    if let Some(body) = body {
        request = request.json(&body);
    }
    if let Some(upload) = upload {
        if upload.filename.is_empty()
            || upload.filename.len() > 255
            || upload.content_type.len() > 128
        {
            return Err(DesktopFailure::invalid_input());
        }
        let data = base64::engine::general_purpose::STANDARD
            .decode(upload.data_base64)
            .map_err(|_| DesktopFailure::invalid_input())?;
        if data.len() > MAX_UPLOAD {
            return Err(DesktopFailure::invalid_input());
        }
        let part = multipart::Part::bytes(data)
            .file_name(upload.filename)
            .mime_str(&upload.content_type)
            .map_err(|_| DesktopFailure::invalid_input())?;
        request = request.multipart(multipart::Form::new().part("file", part));
    }

    let operation = (method != Method::GET).then(Uuid::new_v4);
    let log = |phase: &str, status: &str| {
        if let Some(id) = operation {
            let route = path.split('?').next().unwrap_or(API_ROOT);
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!("kanban_dashboard operation={id} phase={phase} method={method} route={route} status={status}"),
            );
        }
    };
    log("start", "pending");
    let response = request.send().await.map_err(|_| {
        log("finish", "connection_lost");
        DesktopFailure::connection_lost()
    })?;
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        log("finish", "response_too_large");
        return Err(DesktopFailure::operation_failed());
    }
    let binary = !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let bytes = response.bytes().await.map_err(|_| {
        log("finish", "response_interrupted");
        DesktopFailure::connection_lost()
    })?;
    if bytes.len() > MAX_RESPONSE {
        log("finish", "response_too_large");
        return Err(DesktopFailure::operation_failed());
    }
    scope.ensure_current(&state).await.map_err(|error| {
        log("finish", "profile_changed");
        error
    })?;
    if binary {
        log("finish", &status.to_string());
        Ok(json!({"status": status, "content_type": content_type,
            "body_base64": base64::engine::general_purpose::STANDARD.encode(bytes)}))
    } else {
        let body: Value = serde_json::from_slice(&bytes).map_err(|_| {
            log("finish", "invalid_json_response");
            DesktopFailure::operation_failed()
        })?;
        log("finish", &status.to_string());
        Ok(json!({"status": status, "body": body}))
    }
}

#[cfg(test)]
#[path = "tests/kanban_dashboard.rs"]
mod tests;
