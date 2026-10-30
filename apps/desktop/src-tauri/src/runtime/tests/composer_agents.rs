use super::format_roster;
use serde_json::json;

#[test]
fn roster_lists_only_actual_session_tasks() {
    assert_eq!(
        format_roster(&json!({"subagents": [], "delegations": []})),
        "No live subagents or failed delegations in this session."
    );
    let output = format_roster(&json!({
        "subagents": [{"subagent_id": "child-1", "status": "running", "goal": "Review\ncode"}],
        "delegations": [{"delegation_id": "job-2", "task_index": 3, "status": "failed", "goal": "Check tests"}]
    }));
    assert!(
        output.contains("child-1 · running · Review code"),
        "{output}"
    );
    assert!(
        output.contains("job-2 #3 · failed · Check tests"),
        "{output}"
    );
}
