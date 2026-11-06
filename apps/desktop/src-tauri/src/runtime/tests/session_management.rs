use super::{
    archive_shape, import_shape, project_session_health, read_shape, rename_shape, write_shape,
};
use serde_json::json;

#[test]
fn session_routes_are_profile_scoped_and_bounded() {
    let route = read_shape(
        "writer",
        "sessionManagement.list",
        &json!({
            "limit": 25, "offset": 50, "archived": "only", "category": "automation"
        }),
    )
    .unwrap();
    assert!(route.starts_with("/api/sessions?"));
    assert!(route.contains("profile=writer"));
    assert!(route.contains("offset=50"));
    assert!(route.contains("sources=cron%2Ctool"));
    let filtered = read_shape(
        "writer",
        "sessionManagement.list",
        &json!({"category":"chats","excludeSources":["cron","tool"]}),
    )
    .unwrap();
    assert!(filtered.contains("exclude_sources=cron%2Ctool"));
    assert!(!filtered.contains("exclude_sources=cron%2Ctool%2Coneshot"));
    let searched = read_shape(
        "writer",
        "sessionManagement.search",
        &json!({"q":"sample","sources":["cli","telegram"]}),
    )
    .unwrap();
    assert!(searched.contains("sources=cli%2Ctelegram"));
    let empty = read_shape(
        "writer",
        "sessionManagement.search",
        &json!({"q":"sample","excludeSources":[]}),
    )
    .unwrap();
    assert!(empty.contains("source=__hermes_dashboard_no_matching_source__"));
    assert!(read_shape(
        "writer",
        "sessionManagement.list",
        &json!({"source":"cli","sources":["telegram"]})
    )
    .is_err());
    assert!(read_shape(
        "writer",
        "sessionManagement.list",
        &json!({"sources":["cli,telegram"]})
    )
    .is_err());
    assert!(read_shape("writer", "sessionManagement.list", &json!({"limit": 101})).is_err());
    assert!(read_shape(
        "writer",
        "sessionManagement.messages",
        &json!({"id":"../config"})
    )
    .is_err());
    let messages = read_shape(
        "writer",
        "sessionManagement.messages",
        &json!({"id":"session-1"}),
    )
    .unwrap();
    assert!(messages.contains("limit=500"));
    assert!(messages.contains("order=latest"));
    assert!(messages.contains("inline_images=false"));
    assert!(read_shape("writer", "sessionManagement.search", &json!({"q":""})).is_err());
    let health = read_shape("writer", "sessionManagement.health", &json!({})).unwrap();
    assert!(health.starts_with("/api/status?"));
    assert!(health.contains("profile=writer"));
    assert!(write_shape("writer", "sessionManagement.bulkDelete", &json!({"ids":[]})).is_err());
    assert!(write_shape(
        "writer",
        "sessionManagement.prune",
        &json!({"days":0,"dryRun":false})
    )
    .is_err());
}

#[test]
fn session_health_projection_is_bounded_and_omits_unrelated_status_data() {
    let projected = project_session_health(&json!({
        "gateway_running": true,
        "gateway_state": "degraded",
        "gateway_exit_reason": "telegram: token rejected",
        "gateway_platforms": {
            "telegram": {"state":"fatal","error_code":"auth_failed","error_message":"token rejected","secret":"hidden"},
            "bad\u{0000}key": {"state":"fatal"},
        },
        "install_id": "must-not-cross-the-desktop-boundary",
        "nous_session_valid": "valid",
    }));
    assert_eq!(projected["gateway_running"], true);
    assert_eq!(
        projected["gateway_platforms"]["telegram"]["error_message"],
        "token rejected"
    );
    assert!(projected["gateway_platforms"]["telegram"]
        .get("secret")
        .is_none());
    assert!(projected["gateway_platforms"]
        .get("bad\u{0000}key")
        .is_none());
    assert!(projected.get("install_id").is_none());
    assert!(projected.get("nous_session_valid").is_none());
}

#[test]
fn rename_uses_receipt_from_current_snapshot() {
    let (path, body) = rename_shape(
        "writer",
        &json!({"id":"session-1","title":"新标题"}),
        &json!({"exists":true,"runtime_revision":7,"runtime_generation":null}),
    )
    .unwrap();
    assert_eq!(path, "/api/sessions/session-1");
    assert_eq!(body["profile"], "writer");
    assert_eq!(body["expected_revision"], 7);
    assert!(body["request_id"].as_str().unwrap().len() >= 32);
}

#[test]
fn archive_uses_receipt_and_requires_a_boolean_state() {
    let snapshot = json!({"exists":true,"runtime_revision":8,"runtime_generation":3});
    let (path, body) = archive_shape(
        "writer",
        &json!({"id":"session-1","archived":true}),
        &snapshot,
    )
    .unwrap();
    assert_eq!(path, "/api/sessions/session-1");
    assert_eq!(body["profile"], "writer");
    assert_eq!(body["archived"], true);
    assert_eq!(body["expected_revision"], 8);
    assert_eq!(body["expected_generation"], 3);
    assert!(archive_shape("writer", &json!({"id":"session-1"}), &snapshot).is_err());
}

#[test]
#[ignore = "Executed by isolated locked Gateway receiver test"]
fn print_production_shapes_for_gateway_test() {
    let profile = std::env::var("HERMESS_TEST_PROFILE").unwrap();
    let id = std::env::var("HERMESS_TEST_SESSION_ID").unwrap();
    let revision: i64 = std::env::var("HERMESS_TEST_REVISION")
        .unwrap()
        .parse()
        .unwrap();
    let generation: serde_json::Value =
        serde_json::from_str(&std::env::var("HERMESS_TEST_GENERATION").unwrap()).unwrap();
    let imported: serde_json::Value =
        serde_json::from_str(&std::env::var("HERMESS_TEST_IMPORT_SESSION").unwrap()).unwrap();
    let empty_id = std::env::var("HERMESS_TEST_EMPTY_ID").unwrap();
    let write = |operation: &str, payload: serde_json::Value| {
        let (method, route, body) = write_shape(&profile, operation, &payload).unwrap();
        json!([method.as_str(), route, body])
    };
    let shapes = json!({
        "list":read_shape(&profile, "sessionManagement.list", &json!({"limit":25,"offset":0,"category":"chats"})).unwrap(),
        "multiSourceList":read_shape(&profile, "sessionManagement.list", &json!({"limit":25,"offset":0,"category":"all","sources":["cli","telegram"]})).unwrap(),
        "excludedSourceList":read_shape(&profile, "sessionManagement.list", &json!({"limit":25,"offset":0,"category":"all","excludeSources":["cron","tool"]})).unwrap(),
        "search":read_shape(&profile, "sessionManagement.search", &json!({"q":"gateway shape","category":"all"})).unwrap(),
        "stats":read_shape(&profile, "sessionManagement.stats", &json!({})).unwrap(),
        "messages":read_shape(&profile, "sessionManagement.messages", &json!({"id":id})).unwrap(),
        "rename":rename_shape(&profile, &json!({"id":id,"title":"Renamed by product"}),
            &json!({"exists":true,"runtime_revision":revision,"runtime_generation":generation})).unwrap(),
        "archive":archive_shape(&profile, &json!({"id":id,"archived":true}),
            &json!({"exists":true,"runtime_revision":revision + 1,"runtime_generation":generation})).unwrap(),
        "restore":archive_shape(&profile, &json!({"id":id,"archived":false}),
            &json!({"exists":true,"runtime_revision":revision + 2,"runtime_generation":generation})).unwrap(),
        "emptyCount":read_shape(&profile, "sessionManagement.emptyCount", &json!({})).unwrap(),
        "deleteEmpty":write("sessionManagement.deleteEmpty", json!({})),
        "bulkDelete":write("sessionManagement.bulkDelete", json!({"ids":[empty_id]})),
        "prunePreview":write("sessionManagement.prune", json!({"days":90,"dryRun":true,"includeArchived":false})),
        "pruneApply":write("sessionManagement.prune", json!({"days":90,"dryRun":false,"includeArchived":false})),
        "import":import_shape(&profile, &json!({"sessions":[imported]}), &json!({"runtime_revision":0})).unwrap(),
    });
    println!("SESSION_MANAGEMENT_SHAPES={shapes}");
}
