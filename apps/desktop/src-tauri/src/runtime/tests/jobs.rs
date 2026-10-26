use super::gateway_job_result;
use serde_json::json;

#[test]
fn saved_job_with_failed_registration_must_not_be_retried_as_create() {
    let result = gateway_job_result(
        "jobs.create",
        json!({"success":false,"job_saved":true,"retry_create":false,"job_id":"123456abcdef"}),
    )
    .unwrap();
    assert_eq!(result["job_saved"], true);
    assert_eq!(result["scheduler_registered"], false);
    assert_eq!(result["job_id"], "123456abcdef");
    assert!(gateway_job_result("jobs.create", json!({"success":false})).is_err());
    assert!(gateway_job_result(
        "jobs.pause",
        json!({"success":false,"job_saved":true,"retry_create":false,"job_id":"123456abcdef"})
    )
    .is_err());
}
