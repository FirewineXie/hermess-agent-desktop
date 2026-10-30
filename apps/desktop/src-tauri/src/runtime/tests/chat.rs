use super::{
    composer_catalog_params, delete_chat_session_from_gateway, merge_session_lists,
    prompt_submit_params, session_create_params, validate_workspace_path, ReplayResult,
    SessionDeleteGateway,
};
use crate::gateway::GatewayRequestError;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tokio::sync::Mutex as AsyncMutex;

struct DeleteGateway {
    responses: Mutex<Vec<Result<Value, GatewayRequestError>>>,
    calls: Mutex<Vec<(&'static str, Value)>>,
}

impl DeleteGateway {
    fn new(responses: Vec<Result<Value, GatewayRequestError>>) -> Self {
        Self {
            responses: Mutex::new(responses.into_iter().rev().collect()),
            calls: Mutex::new(Vec::new()),
        }
    }
}

impl SessionDeleteGateway for DeleteGateway {
    async fn request(
        &self,
        method: &'static str,
        params: Value,
    ) -> Result<Value, GatewayRequestError> {
        self.calls.lock().unwrap().push((method, params));
        self.responses.lock().unwrap().pop().unwrap()
    }

    async fn retry_delete(&self, params: Value) -> Result<Value, GatewayRequestError> {
        self.request("session.mutate", params).await
    }
}

async fn delete(
    gateway: &DeleteGateway,
    session_id: &str,
    keep_view: bool,
) -> Result<Value, String> {
    delete_chat_session_from_gateway(
        gateway,
        session_id,
        keep_view,
        "",
        &AsyncMutex::new(HashMap::new()),
        ("epoch".into(), "default".into(), session_id.into()),
    )
    .await
}

#[tokio::test]
async fn deletes_stored_session_with_the_gateway_contract_fields() {
    let gateway = DeleteGateway::new(vec![
        Ok(json!({"sessions":[{"id":"stored"}]})),
        Ok(json!({"session_id":"stored","revision":3,"execution_generation":2})),
        Ok(json!({"session_id":"stored","operation":"delete","deleted_ids":["stored"]})),
    ]);
    assert_eq!(
        delete(&gateway, "stored", false).await.unwrap(),
        json!({"session_id":"stored","operation":"delete","deleted_ids":["stored"]})
    );
    let calls = gateway.calls.lock().unwrap();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0], ("session.list", json!({"limit":200})));
    assert_eq!(calls[1], ("session.resume", json!({"session_id":"stored"})));
    assert_eq!(calls[2].0, "session.mutate");
    assert_eq!(calls[2].1["session_id"], "stored");
    assert_eq!(calls[2].1["operation"], "delete");
    assert_eq!(calls[2].1["payload"], json!({}));
    assert_eq!(calls[2].1["expected_revision"], 3);
    assert_eq!(calls[2].1["expected_generation"], 2);
    assert!(calls[2].1["request_id"].as_str().is_some());
}

#[tokio::test]
async fn rejected_mutation_releases_the_resume_subscription() {
    let gateway = DeleteGateway::new(vec![
        Ok(json!({"sessions":[{"id":"stored"}]})),
        Ok(
            json!({"session_id":"stored","revision":3,"execution_generation":2,"subscription_id":"sub"}),
        ),
        Err(GatewayRequestError::Rpc {
            message: "session_busy".into(),
            code: 4009,
        }),
        Ok(json!({"detached":true})),
    ]);
    assert!(delete(&gateway, "stored", false).await.is_err());
    let calls = gateway.calls.lock().unwrap();
    assert_eq!(
        calls.iter().map(|(method, _)| *method).collect::<Vec<_>>(),
        [
            "session.list",
            "session.resume",
            "session.mutate",
            "session.detach"
        ]
    );
    assert_eq!(
        calls[3].1,
        json!({"session_id":"stored","subscription_id":"sub"})
    );
}

#[tokio::test]
async fn rejected_delete_keeps_the_current_view_subscription() {
    let gateway = DeleteGateway::new(vec![
        Ok(json!({"sessions":[{"id":"current"}]})),
        Ok(
            json!({"session_id":"current","revision":3,"execution_generation":2,"subscription_id":"view"}),
        ),
        Err(GatewayRequestError::Rpc {
            message: "session_busy".into(),
            code: 4009,
        }),
    ]);
    assert!(delete(&gateway, "current", true).await.is_err());
    assert_eq!(
        gateway
            .calls
            .lock()
            .unwrap()
            .iter()
            .map(|(method, _)| *method)
            .collect::<Vec<_>>(),
        ["session.list", "session.resume", "session.mutate"]
    );
}

#[tokio::test]
async fn rejected_compressed_tip_keeps_the_resolved_current_view_subscription() {
    let gateway = DeleteGateway::new(vec![
        Ok(json!({"sessions":[{"id":"tip"}]})),
        Ok(
            json!({"session_id":"root","revision":3,"execution_generation":2,"subscription_id":"view"}),
        ),
        Err(GatewayRequestError::Rpc {
            message: "session_busy".into(),
            code: 4009,
        }),
    ]);
    let pending = AsyncMutex::new(HashMap::new());
    let key = ("home".into(), "default".into(), "tip".into());
    assert!(
        delete_chat_session_from_gateway(&gateway, "tip", false, "root", &pending, key)
            .await
            .is_err()
    );
    assert_eq!(
        gateway
            .calls
            .lock()
            .unwrap()
            .iter()
            .map(|(method, _)| *method)
            .collect::<Vec<_>>(),
        ["session.list", "session.resume", "session.mutate"]
    );
}

#[tokio::test]
async fn malformed_snapshot_releases_only_a_new_attachment() {
    let gateway = DeleteGateway::new(vec![
        Ok(json!({"sessions":[{"id":"stored"}]})),
        Ok(json!({"session_id":"stored","subscription_id":"new","revision":1})),
        Ok(json!({"detached":true})),
    ]);
    assert!(delete(&gateway, "stored", false).await.is_err());
    let calls = gateway.calls.lock().unwrap();
    assert_eq!(
        calls[2],
        (
            "session.detach",
            json!({"session_id":"stored","subscription_id":"new"})
        )
    );
}

#[tokio::test]
async fn unknown_mutation_result_retries_the_exact_request_before_listing() {
    let gateway = DeleteGateway::new(vec![
        Ok(json!({"sessions":[{"id":"stored"}]})),
        Ok(
            json!({"session_id":"stored","revision":3,"execution_generation":2,"subscription_id":"new"}),
        ),
        Err(GatewayRequestError::Transport("网关连接已断开".into())),
        Ok(json!({"detached":true})),
        Ok(json!({"deleted_ids":["stored"]})),
    ]);
    let pending = AsyncMutex::new(HashMap::new());
    let key = ("epoch".into(), "default".into(), "stored".into());
    assert!(
        delete_chat_session_from_gateway(&gateway, "stored", false, "", &pending, key.clone())
            .await
            .is_err()
    );
    assert!(pending.lock().await.contains_key(&key));
    assert!(
        delete_chat_session_from_gateway(&gateway, "stored", false, "", &pending, key.clone())
            .await
            .is_ok()
    );
    assert!(!pending.lock().await.contains_key(&key));
    let calls = gateway.calls.lock().unwrap();
    assert_eq!(
        calls.iter().map(|(method, _)| *method).collect::<Vec<_>>(),
        [
            "session.list",
            "session.resume",
            "session.mutate",
            "session.detach",
            "session.mutate"
        ]
    );
    assert_eq!(calls[2].1, calls[4].1);
}

#[tokio::test]
async fn authority_deletes_a_compressed_conversation_in_one_mutation() {
    let gateway = DeleteGateway::new(vec![
        Ok(json!({"sessions":[{"id":"tip","_lineage_root_id":"root"}]})),
        Ok(json!({"session_id":"tip","revision":1,"execution_generation":1})),
        Ok(json!({"session_id":"tip","operation":"delete","deleted_ids":["root","middle","tip"]})),
    ]);
    assert!(delete(&gateway, "tip", false).await.is_ok());
    let calls = gateway.calls.lock().unwrap();
    assert_eq!(
        calls.iter().map(|(method, _)| *method).collect::<Vec<_>>(),
        ["session.list", "session.resume", "session.mutate"]
    );
}

#[tokio::test]
async fn refuses_unknown_profile_session_before_any_mutation() {
    let gateway = DeleteGateway::new(vec![Ok(json!({"sessions":[]})), Ok(json!({"sessions":[]}))]);
    assert!(delete(&gateway, "other-profile-id", false).await.is_err());
    assert_eq!(gateway.calls.lock().unwrap().len(), 2);
}

#[test]
fn command_catalog_uses_profile_scope_before_a_session_exists() {
    assert_eq!(composer_catalog_params("").unwrap(), json!({}));
    assert_eq!(
        composer_catalog_params("session-1").unwrap(),
        json!({"session_id": "session-1"})
    );
    assert!(composer_catalog_params(&"x".repeat(257)).is_err());
}

#[test]
fn recent_sessions_include_stored_rows_after_gateway_restart() {
    let live = json!({"sessions": [{"id": "current", "started_at": 20}]});
    let stored = json!({"sessions": [
        {"id": "current", "started_at": 20},
        {"id": "previous", "started_at": 10}
    ]});
    let merged = merge_session_lists(&live, &stored);
    assert_eq!(merged["sessions"].as_array().unwrap().len(), 2);
    assert_eq!(merged["sessions"][0]["id"], "current");
    assert_eq!(merged["sessions"][1]["id"], "previous");
}

#[test]
fn selected_workspace_must_be_an_existing_absolute_directory() {
    assert!(validate_workspace_path(None).unwrap().is_none());
    assert!(validate_workspace_path(Some(String::new()))
        .unwrap()
        .is_none());
    let current = std::env::current_dir()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert_eq!(
        validate_workspace_path(Some(current.clone())).unwrap(),
        Some(current)
    );
    assert!(validate_workspace_path(Some("relative-folder".into())).is_err());
    let missing = std::env::current_dir()
        .unwrap()
        .join("missing-hermess-workspace-test");
    assert!(validate_workspace_path(Some(missing.to_string_lossy().into_owned())).is_err());
}

#[test]
fn default_workspace_leaves_cwd_out_of_the_gateway_request() {
    let default = session_create_params(None, None, None, None);
    assert_eq!(default["source"], "gui");
    assert!(default.get("cwd").is_none());
    assert!(default.get("cwd_explicit").is_none());
    let selected = session_create_params(Some("C:\\work".into()), None, None, None);
    assert_eq!(selected["cwd"], "C:\\work");
    assert_eq!(selected["cwd_explicit"], true);
    let prepared = session_create_params(
        None,
        Some("custom:ark".into()),
        Some("model-1".into()),
        Some("high".into()),
    );
    assert_eq!(prepared["provider"], "custom:ark");
    assert_eq!(prepared["model"], "model-1");
    assert_eq!(prepared["reasoning"], "high");
}

#[test]
fn canonical_prompt_submit_declares_batch_clarification_support() {
    let prepared = prompt_submit_params("session-example".into(), "Choose a file".into());
    assert_eq!(prepared["session_id"], "session-example");
    assert_eq!(prepared["text"], "Choose a file");
    assert_eq!(prepared["clarify_batch"], true);
    assert!(prepared["submission_id"]
        .as_str()
        .is_some_and(|id| !id.is_empty()));
}

#[test]
fn replay_result_accepts_valid_shape_and_rejects_missing_watermark() {
    let sample = json!({
        "events": [{
            "type": "message.delta", "session_id": "session-example", "seq": 2,
            "payload": {"text": "hello"}
        }],
        "latest_seq": 2, "count": 1, "epoch": "example-epoch", "truncated": false,
        "open_requests": [{
            "id": "srq-2", "method": "clarify", "params": {
                "session_id": "session-example",
                "questions": [{"qid": "q1", "question": "Which option?", "choices": null}]
            }
        }]
    });
    let result: ReplayResult = serde_json::from_value(sample.clone()).unwrap();
    assert_eq!(serde_json::to_value(result).unwrap(), sample);
    let mut missing_watermark = sample;
    missing_watermark
        .as_object_mut()
        .unwrap()
        .remove("latest_seq");
    assert!(serde_json::from_value::<ReplayResult>(missing_watermark).is_err());
}
