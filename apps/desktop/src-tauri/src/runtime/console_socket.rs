use super::{profile_scope::ResolvedProfileScope, BackendState};
use crate::{diagnostics::append_client_event, errors::DesktopFailure};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::{collections::HashMap, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};
use tokio::time::timeout;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};
use uuid::Uuid;

const MAX_FRAME_BYTES: usize = 256 * 1024;

#[derive(Default)]
pub struct ConsoleSockets(Mutex<HashMap<String, ConsoleSocketEntry>>);

struct ConsoleSocketEntry {
    profile: String,
    sender: mpsc::UnboundedSender<ConsoleCommand>,
}

enum ConsoleCommand {
    Send(String),
    Close,
}

#[derive(Clone, Serialize)]
struct ConsoleSocketEvent {
    subscription: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

pub(super) fn console_ws_request(
    port: u16,
    header: &str,
    credential: &str,
    profile: &str,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, DesktopFailure> {
    let mut url = reqwest::Url::parse(&format!("ws://127.0.0.1:{port}/api/console"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    url.query_pairs_mut().append_pair("profile", profile);
    if header == "X-Hermes-Session-Token" {
        url.query_pairs_mut().append_pair("token", credential);
    }
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| DesktopFailure::operation_failed())?;
    if header == "X-Hermes-Gateway-Ticket" {
        request.headers_mut().insert(
            "X-Hermes-Gateway-Ticket",
            HeaderValue::from_str(credential).map_err(|_| DesktopFailure::invalid_input())?,
        );
    }
    Ok(request)
}

fn log_socket(scope: &ResolvedProfileScope, subscription: &str, phase: &str, outcome: &str) {
    let _ = append_client_event(
        &scope.storage,
        &format!(
            "hermes_console subscription={subscription} profile={} phase={phase} outcome={outcome}",
            scope.profile
        ),
    );
}

fn valid_console_command(data: &str) -> bool {
    if data.len() > MAX_FRAME_BYTES {
        return false;
    }
    let frame_type = serde_json::from_str::<serde_json::Value>(data)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .and_then(|object| object.get("type")?.as_str().map(str::to_owned));
    matches!(
        frame_type.as_deref(),
        Some("input" | "command" | "confirm" | "cancel" | "ping")
    )
}

#[tauri::command]
pub async fn console_socket_subscribe(
    state: State<'_, BackendState>,
    sockets: State<'_, ConsoleSockets>,
    app: AppHandle,
    profile: String,
    subscription: String,
) -> Result<(), DesktopFailure> {
    Uuid::parse_str(&subscription).map_err(|_| DesktopFailure::invalid_input())?;
    let scope = state.resolve_profile(&profile).await?;
    scope.ensure_current(&state).await?;
    let (port, header, credential) = scope.http_auth().await?;
    let request = console_ws_request(port, header, &credential, &scope.profile)?;
    log_socket(&scope, &subscription, "start", "connecting");
    let (mut socket, _) = timeout(Duration::from_secs(10), connect_async(request))
        .await
        .map_err(|_| {
            log_socket(&scope, &subscription, "finish", "timeout");
            DesktopFailure::connection_lost()
        })?
        .map_err(|_| {
            log_socket(&scope, &subscription, "finish", "rejected");
            DesktopFailure::connection_lost()
        })?;
    scope.ensure_current(&state).await?;
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let mut active = sockets.0.lock().await;
    if active.contains_key(&subscription) {
        drop(active);
        let _ = socket.close(None).await;
        log_socket(&scope, &subscription, "finish", "duplicate_subscription");
        return Err(DesktopFailure::invalid_input());
    }
    active.insert(
        subscription.clone(),
        ConsoleSocketEntry {
            profile: scope.profile.clone(),
            sender,
        },
    );
    drop(active);
    log_socket(&scope, &subscription, "connected", "ok");

    let task_app = app.clone();
    let task_subscription = subscription.clone();
    let storage = scope.storage.clone();
    let task_profile = scope.profile.clone();
    tokio::spawn(async move {
        let mut socket = socket;
        let mut reason = "ended";
        loop {
            tokio::select! {
                command = receiver.recv() => match command {
                    Some(ConsoleCommand::Send(data)) => {
                        if socket.send(Message::Text(data.into())).await.is_err() {
                            reason = "write_failed";
                            break;
                        }
                    }
                    Some(ConsoleCommand::Close) | None => {
                        let _ = socket.close(None).await;
                        break;
                    }
                },
                frame = socket.next() => match frame {
                    Some(Ok(Message::Text(data))) => {
                        if data.len() > MAX_FRAME_BYTES {
                            reason = "invalid_frame";
                            break;
                        }
                        if task_app.emit("hermes-console-event", ConsoleSocketEvent {
                            subscription: task_subscription.clone(), kind: "message",
                            data: Some(data.to_string()), reason: None,
                        }).is_err() { break; }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            reason = "write_failed";
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Binary(_))) => {
                        reason = "invalid_frame";
                        break;
                    }
                    Some(Err(_)) => {
                        reason = "read_failed";
                        break;
                    }
                    _ => {}
                }
            }
        }
        let _ = task_app.emit(
            "hermes-console-event",
            ConsoleSocketEvent {
                subscription: task_subscription.clone(),
                kind: "closed",
                data: None,
                reason: Some(reason),
            },
        );
        task_app
            .state::<ConsoleSockets>()
            .0
            .lock()
            .await
            .remove(&task_subscription);
        let _ = append_client_event(
            &storage,
            &format!(
                "hermes_console subscription={task_subscription} profile={task_profile} phase=finish outcome={reason}"
            ),
        );
    });
    Ok(())
}

#[tauri::command]
pub async fn console_socket_send(
    sockets: State<'_, ConsoleSockets>,
    profile: String,
    subscription: String,
    data: String,
) -> Result<(), DesktopFailure> {
    Uuid::parse_str(&subscription).map_err(|_| DesktopFailure::invalid_input())?;
    if !valid_console_command(&data) {
        return Err(DesktopFailure::invalid_input());
    }
    let sockets = sockets.0.lock().await;
    let entry = sockets
        .get(&subscription)
        .filter(|entry| entry.profile == profile)
        .ok_or_else(DesktopFailure::invalid_input)?;
    entry
        .sender
        .send(ConsoleCommand::Send(data))
        .map_err(|_| DesktopFailure::connection_lost())
}

#[tauri::command]
pub async fn console_socket_unsubscribe(
    sockets: State<'_, ConsoleSockets>,
    profile: String,
    subscription: String,
) -> Result<(), DesktopFailure> {
    Uuid::parse_str(&subscription).map_err(|_| DesktopFailure::invalid_input())?;
    let mut sockets = sockets.0.lock().await;
    if sockets
        .get(&subscription)
        .is_some_and(|entry| entry.profile != profile)
    {
        return Err(DesktopFailure::invalid_input());
    }
    if let Some(entry) = sockets.remove(&subscription) {
        let _ = entry.sender.send(ConsoleCommand::Close);
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/console_socket.rs"]
mod tests;
