use super::{event_request, is_task_create, valid_board, valid_route, TASK_CREATE_LOCK};
use reqwest::Method;

#[test]
fn kanban_bridge_rejects_routes_outside_the_locked_plugin() {
    assert!(valid_route("/api/plugins/kanban/board?board=default"));
    assert!(valid_route("/api/plugins/kanban/tasks/t_12345678"));
    assert!(!valid_route("/api/config"));
    assert!(!valid_route("/api/plugins/kanban-other/tasks"));
    assert!(!valid_route("/api/plugins/kanban/../config"));
    assert!(!valid_route("/api/plugins/kanban/tasks\\other"));
}

#[test]
fn only_task_creation_uses_the_shared_idempotency_gate() {
    assert!(is_task_create(
        &Method::POST,
        "/api/plugins/kanban/tasks?board=default"
    ));
    assert!(!is_task_create(
        &Method::PATCH,
        "/api/plugins/kanban/tasks/task-12345678"
    ));
    assert!(!is_task_create(&Method::POST, "/api/plugins/kanban/boards"));
}

#[tokio::test]
async fn shared_task_creation_gate_excludes_a_second_creator() {
    let first = TASK_CREATE_LOCK.lock().await;
    assert!(TASK_CREATE_LOCK.try_lock().is_err());
    drop(first);
    assert!(TASK_CREATE_LOCK.try_lock().is_ok());
}

#[test]
fn kanban_event_stream_validates_board_and_uses_the_locked_ws_credentials() {
    assert!(valid_board("default"));
    assert!(valid_board("research-2"));
    assert!(!valid_board("../default"));
    assert!(!valid_board("Research"));
    assert!(!valid_board("_hidden"));

    let token = event_request(
        8765,
        "X-Hermes-Session-Token",
        "secret value",
        "default",
        42,
    )
    .expect("session request");
    let token_uri = token.uri().to_string();
    assert!(token_uri.starts_with("ws://127.0.0.1:8765/api/plugins/kanban/events?"));
    assert!(token_uri.contains("board=default"));
    assert!(token_uri.contains("since=42"));
    assert!(token_uri.contains("token=secret+value") || token_uri.contains("token=secret%20value"));
    assert!(!token.headers().contains_key("X-Hermes-Session-Token"));

    let ticket = event_request(
        8765,
        "X-Hermes-Gateway-Ticket",
        "native-ticket",
        "research-2",
        7,
    )
    .expect("ticket request");
    assert_eq!(
        ticket
            .headers()
            .get("X-Hermes-Gateway-Ticket")
            .and_then(|value| value.to_str().ok()),
        Some("native-ticket")
    );
    assert!(!ticket.uri().to_string().contains("native-ticket"));
}
