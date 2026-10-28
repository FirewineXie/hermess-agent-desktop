use super::{
    prune_abandoned_rpc, register_owner, result_session_owners, validate_server_answer,
    GatewayClient, PendingRpc,
};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{
    sync::{mpsc, oneshot},
    time::timeout,
};

#[test]
fn timed_out_calls_release_pending_capacity() {
    let mut pending = PendingRpc::new();
    for id in 0..64 {
        let (reply, received) = oneshot::channel::<Result<Value, String>>();
        pending.insert(id, ("session.resume", reply));
        drop(received);
    }
    let (reply, _received) = oneshot::channel::<Result<Value, String>>();
    pending.insert(64, ("session.resume", reply));
    prune_abandoned_rpc(&mut pending);
    assert_eq!(pending.len(), 1);
    assert!(pending.contains_key(&64));
}

#[test]
fn session_owner_is_recorded_from_successful_results_and_conflicts_fail_closed() {
    let mut owners = HashMap::new();
    result_session_owners(
        &mut owners,
        "session.create",
        &json!({}),
        &json!({"session_id":"live-a","stored_session_id":"stored-a"}),
        "writer",
    );
    result_session_owners(
        &mut owners,
        "session.list",
        &json!({}),
        &json!({"sessions":[{"id":"stored-b"}]}),
        "reviewer",
    );
    assert_eq!(
        owners.get("live-a").and_then(Option::as_deref),
        Some("writer")
    );
    assert_eq!(
        owners.get("stored-a").and_then(Option::as_deref),
        Some("writer")
    );
    assert_eq!(
        owners.get("stored-b").and_then(Option::as_deref),
        Some("reviewer")
    );
    register_owner(&mut owners, "live-a", "reviewer");
    assert_eq!(owners.get("live-a").and_then(Option::as_deref), None);
    register_owner(&mut owners, "live-a", "writer");
    assert_eq!(owners.get("live-a").and_then(Option::as_deref), None);
}

#[test]
fn answer_must_match_the_open_request_method_and_choices() {
    let requests = HashMap::from([(
        "srq-1".to_string(),
        (
            "approval".to_string(),
            json!({"session_id":"s1","choices":["once","deny"]}),
        ),
    )]);
    assert!(validate_server_answer(
        &requests,
        "srq-1",
        "approval",
        &json!({"choice":"once"}),
        "s1"
    )
    .is_ok());
    assert!(
        validate_server_answer(&requests, "srq-1", "clarify", &json!({"answers":{}}), "s1")
            .is_err()
    );
    assert!(validate_server_answer(
        &requests,
        "srq-1",
        "approval",
        &json!({"choice":"once"}),
        "s2"
    )
    .is_err());
    assert!(validate_server_answer(
        &requests,
        "srq-1",
        "approval",
        &json!({"choice":"always"}),
        "s1"
    )
    .is_err());
    assert!(validate_server_answer(
        &requests,
        "srq-missing",
        "approval",
        &json!({"choice":"deny"}),
        "s1"
    )
    .is_err());
}

#[test]
fn canonical_approval_answer_uses_the_prompt_id_and_declared_choices() {
    let requests = HashMap::from([(
        "approval-1".to_string(),
        (
            "approval".to_string(),
            json!({
                "session_id":"s1",
                "request_id":"approval-1",
                "execution_generation":3,
                "choices":["once","deny"]
            }),
        ),
    )]);
    assert!(validate_server_answer(
        &requests,
        "approval-1",
        "approval",
        &json!({"choice":"deny"}),
        "s1"
    )
    .is_ok());
    assert!(validate_server_answer(
        &requests,
        "approval-1",
        "approval",
        &json!({"choice":"always"}),
        "s1"
    )
    .is_err());
}

#[test]
fn clarify_answer_must_use_questions_from_the_open_request() {
    let requests = HashMap::from([(
        "srq-2".to_string(),
        (
            "clarify".to_string(),
            json!({"session_id":"s2","questions":[{"qid":"q1"},{"qid":"q2"}]}),
        ),
    )]);
    assert!(validate_server_answer(
        &requests,
        "srq-2",
        "clarify",
        &json!({"answers":{"q1":"yes","q2":null},"outcome":"submitted"}),
        "s2"
    )
    .is_ok());
    assert!(validate_server_answer(
        &requests,
        "srq-2",
        "clarify",
        &json!({"answers":{"other":"yes"},"outcome":"submitted"}),
        "s2"
    )
    .is_err());
    assert!(validate_server_answer(
        &requests,
        "srq-2",
        "clarify",
        &json!({"answers":{"q1":42},"outcome":"submitted"}),
        "s2"
    )
    .is_err());
    assert!(validate_server_answer(&requests, "srq-2", "clarify", &json!({}), "s2").is_err());
}

#[tokio::test]
async fn closing_an_old_gateway_releases_an_inflight_rpc() {
    let (sender, mut receiver) = mpsc::channel(1);
    let (queued, observed) = oneshot::channel();
    let task = tokio::spawn(async move {
        let _command = receiver.recv().await;
        let _ = queued.send(());
        std::future::pending::<()>().await;
    });
    let gateway = Arc::new(GatewayClient {
        sender,
        task,
        replay_epoch: String::new(),
    });
    let waiting = {
        let gateway = Arc::clone(&gateway);
        tokio::spawn(async move { gateway.request("session.list", json!({})).await })
    };
    observed.await.unwrap();
    gateway.close();
    assert!(timeout(Duration::from_secs(1), waiting)
        .await
        .unwrap()
        .unwrap()
        .is_err());
}

#[tokio::test]
async fn closing_an_old_gateway_releases_an_inflight_answer() {
    let (sender, mut receiver) = mpsc::channel(1);
    let (queued, observed) = oneshot::channel();
    let task = tokio::spawn(async move {
        let _command = receiver.recv().await;
        let _ = queued.send(());
        std::future::pending::<()>().await;
    });
    let gateway = Arc::new(GatewayClient {
        sender,
        task,
        replay_epoch: String::new(),
    });
    let waiting = {
        let gateway = Arc::clone(&gateway);
        tokio::spawn(async move {
            gateway
                .answer(
                    "srq-1".into(),
                    "clarify".into(),
                    json!({"answers":{}}),
                    "s1".into(),
                    "default".into(),
                )
                .await
        })
    };
    observed.await.unwrap();
    gateway.close();
    assert!(timeout(Duration::from_secs(1), waiting)
        .await
        .unwrap()
        .unwrap()
        .is_err());
}
