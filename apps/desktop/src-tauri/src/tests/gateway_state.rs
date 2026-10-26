use super::{prune_abandoned_rpc, validate_server_answer, GatewayClient, PendingRpc};
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
fn answer_must_match_the_open_request_method_and_choices() {
    let requests = HashMap::from([(
        "srq-1".to_string(),
        ("approval".to_string(), json!({"choices":["once","deny"]})),
    )]);
    assert!(
        validate_server_answer(&requests, "srq-1", "approval", &json!({"choice":"once"})).is_ok()
    );
    assert!(validate_server_answer(&requests, "srq-1", "clarify", &json!({"answers":{}})).is_err());
    assert!(
        validate_server_answer(&requests, "srq-1", "approval", &json!({"choice":"always"}))
            .is_err()
    );
    assert!(validate_server_answer(
        &requests,
        "srq-missing",
        "approval",
        &json!({"choice":"deny"})
    )
    .is_err());
}

#[test]
fn clarify_answer_must_use_questions_from_the_open_request() {
    let requests = HashMap::from([(
        "srq-2".to_string(),
        (
            "clarify".to_string(),
            json!({"questions":[{"qid":"q1"},{"qid":"q2"}]}),
        ),
    )]);
    assert!(validate_server_answer(
        &requests,
        "srq-2",
        "clarify",
        &json!({"answers":{"q1":"yes","q2":null},"outcome":"submitted"})
    )
    .is_ok());
    assert!(validate_server_answer(
        &requests,
        "srq-2",
        "clarify",
        &json!({"answers":{"other":"yes"},"outcome":"submitted"})
    )
    .is_err());
    assert!(validate_server_answer(
        &requests,
        "srq-2",
        "clarify",
        &json!({"answers":{"q1":42},"outcome":"submitted"})
    )
    .is_err());
    assert!(validate_server_answer(&requests, "srq-2", "clarify", &json!({})).is_err());
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
                .answer("srq-1".into(), "clarify".into(), json!({"answers":{}}))
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
