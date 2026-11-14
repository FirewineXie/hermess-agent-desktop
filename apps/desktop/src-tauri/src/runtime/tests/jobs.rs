use super::{
    blueprint_payload, blueprint_url, cron_job_url, cron_mutation, gateway_job_result,
    partial_create_response,
};
use serde_json::json;

#[test]
#[ignore = "run by the isolated locked Gateway receiver probe"]
fn print_production_gateway_feature_cron() {
    let input = json!({"name":"desktop-cron-probe", "schedule":"0 0 1 1 *", "deliver":"local", "script":"stop-probe.py", "no_agent":true, "catch_up":true, "timezone":"Asia/Shanghai", "grace_minutes":0});
    let create = cron_mutation(&input, true).unwrap();
    let mut invalid = input.clone();
    invalid["timezone"] = json!("Invalid/Zone");
    let invalid_timezone = cron_mutation(&invalid, true).unwrap();
    let mut room = input.clone();
    room["deliver"] = json!("room:0cc45a54-c64f-41b8-b0c0-d6489806fbaa@default");
    room["script"] = json!("room-probe.py");
    let room_delivery = cron_mutation(&room, true).unwrap();
    let mut edit = input;
    edit["catch_up"] = json!(null);
    edit["timezone"] = json!(null);
    edit["grace_minutes"] = json!(null);
    let update = cron_mutation(&edit, false).unwrap();
    for (id, method, job, suffix, body) in [
        ("cron-create", "POST", None, None, Some(create)),
        ("cron-room-create", "POST", None, None, Some(room_delivery)),
        (
            "cron-invalid-timezone",
            "POST",
            None,
            None,
            Some(invalid_timezone),
        ),
        (
            "cron-edit",
            "PUT",
            Some("123456abcdef"),
            None,
            Some(json!({"updates": update})),
        ),
        (
            "cron-trigger",
            "POST",
            Some("123456abcdef"),
            Some("trigger"),
            None,
        ),
        (
            "cron-stop",
            "POST",
            Some("123456abcdef"),
            Some("cancel"),
            None,
        ),
    ] {
        let url = cron_job_url(1420, "default", job, suffix).unwrap();
        println!(
            "FEATURE_SHAPE={}",
            json!({"id": id, "method": method, "path": format!("{}?{}", url.path(), url.query().unwrap()), "body": body})
        );
    }
}

#[test]
fn saved_job_with_failed_registration_must_not_be_retried_as_create() {
    let result = partial_create_response(&json!({"detail":{
        "job_saved":true,"retry_create":false,"scheduler_registered":false,"job_id":"123456abcdef"
    }}))
    .unwrap();
    assert_eq!(result["job_saved"], true);
    assert_eq!(result["scheduler_registered"], false);
    assert_eq!(result["job_id"], "123456abcdef");
    assert!(partial_create_response(&json!({"detail":{"retry_create":true}})).is_none());
    assert!(gateway_job_result(
        json!({"success":false,"job_saved":true,"retry_create":false,"job_id":"123456abcdef"})
    )
    .is_err());
}

#[test]
fn blueprint_fields_are_bounded() {
    assert!(blueprint_payload(
        &json!({"blueprint":"morning-brief","values":{"time":"08:00","deliver":"local"}})
    )
    .is_ok());
    assert!(
        blueprint_payload(&json!({"blueprint":"morning-brief","values":{"bad-key":"x"}})).is_ok()
    );
    assert!(
        blueprint_payload(&json!({"blueprint":"morning-brief","values":{"bad\nkey":"x"}})).is_err()
    );
    assert!(blueprint_payload(&json!({"blueprint":"morning-brief","values":{"time":42}})).is_err());
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_blueprint_shapes() {
    for (method, instantiate) in [("GET", false), ("POST", true)] {
        let url = blueprint_url(1420, "default", instantiate).unwrap();
        let body = instantiate.then(|| {
            blueprint_payload(
                &json!({"blueprint":"morning-brief","values":{"time":"08:00","deliver":"local"}}),
            )
            .unwrap()
        });
        println!(
            "BLUEPRINT_SHAPE={}",
            json!({"method":method,"path":format!("{}?{}",url.path(),url.query().unwrap_or("")),"body":body})
        );
    }
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_cron_trigger_shape() {
    let url = cron_job_url(1420, "default", Some("123456abcdef"), Some("trigger")).unwrap();
    println!(
        "TRIGGER_SHAPE={}",
        json!({"method":"POST","path":format!("{}?{}",url.path(),url.query().unwrap_or(""))})
    );
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_cron_dashboard_shapes() {
    let create = cron_mutation(
        &json!({"name":"isolated-cron","prompt":"say hello",
        "schedule":"0 9 * * *","deliver":"local","provider":"test-provider",
        "model":"test-model","context_from":["self"]}),
        true,
    )
    .unwrap();
    println!(
        "CRON_SHAPE={}",
        json!({"method":"POST","path":"/api/cron/jobs?profile=default","body":create})
    );
    let update = cron_mutation(
        &json!({"name":"isolated-cron-edited","prompt":"say hello again",
        "schedule":"0 10 * * *","deliver":"local","provider":"","model":""}),
        false,
    )
    .unwrap();
    let update_url = cron_job_url(1420, "default", Some("123456abcdef"), None).unwrap();
    println!(
        "CRON_SHAPE={}",
        json!({"method":"PUT","path":format!("{}?{}",update_url.path(),update_url.query().unwrap_or("")),"body":{"updates":update}})
    );
    for (method, suffix) in [("GET", Some("runs")), ("DELETE", None)] {
        let url = cron_job_url(1420, "default", Some("123456abcdef"), suffix).unwrap();
        println!(
            "CRON_SHAPE={}",
            json!({"method":method,"path":format!("{}?{}",url.path(),url.query().unwrap_or(""))})
        );
    }
}
