use super::{
    composer_catalog_params, merge_session_lists, prompt_submit_params, session_create_params,
    validate_workspace_path, ReplayResult,
};
use serde_json::json;

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
