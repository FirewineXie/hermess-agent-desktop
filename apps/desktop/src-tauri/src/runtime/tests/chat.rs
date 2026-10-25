use super::{merge_session_lists, ReplayResult};
use serde_json::json;

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
