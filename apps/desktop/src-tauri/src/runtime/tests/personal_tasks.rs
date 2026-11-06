use super::{create_body, detail_view, ensure_owner, request_id, required, task_path, view};
use serde_json::json;

#[test]
fn task_paths_and_required_fields_reject_untrusted_values() {
    assert_eq!(task_path("a1b2c3d4").unwrap(), "/tasks/a1b2c3d4");
    assert!(task_path("../other").is_err());
    assert!(required(&json!({"body": " "}), "body", 20000).is_err());
    assert!(request_id(&json!({"request_id": "not-a-uuid"})).is_err());
}

#[test]
#[ignore]
fn print_production_personal_task_create_body() {
    let body = create_body(
        "default",
        "Full flow",
        "Make a result",
        "18ed4197-61cf-469e-990c-f689ff16695f",
        false,
    );
    println!("PRODUCTION_PERSONAL_TASK_CREATE={body}");
}

#[test]
fn dashboard_payload_is_reduced_to_product_contract() {
    let raw = json!({"task": {"id": "a1b2c3d4", "tenant": "hermess-desktop-default",
        "title": "Task", "status": "blocked", "latest_summary": "Progress"},
        "comments": [{"author": "hermess-user:request", "body": "More detail"}],
        "events": [], "attachments": []});
    let result = detail_view(raw, "default");
    assert_eq!(result["task"]["summary"], "Progress");
    assert_eq!(result["comments"][0]["author"], "user");
    assert!(view(&json!({"id": "a1b2c3d4"}), "default")
        .get("tenant")
        .is_none());
}

#[test]
fn task_detail_cannot_cross_profile_tenant() {
    let raw = json!({"task": {"tenant": "hermess-desktop-default"}});
    assert!(ensure_owner(&raw, "default").is_ok());
    assert!(ensure_owner(&raw, "research").is_err());
}
