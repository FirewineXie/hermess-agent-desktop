use super::{creation_body, name, request_shape};
use serde_json::json;

#[test]
fn webhook_name_rejects_path_and_query_characters() {
    for value in [
        "",
        "../other",
        "other?profile=default",
        "bad/name",
        "-leading",
        "UPPER",
    ] {
        assert!(name(&json!({"name": value})).is_err());
    }
    assert_eq!(
        name(&json!({"name": "github-push_2"})).unwrap(),
        "github-push_2"
    );
}

#[test]
fn webhook_creation_sends_only_supported_fields() {
    let body = creation_body(&json!({
        "name": "github-push", "description": "source", "events": ["push"],
        "deliver": "log", "deliver_only": false, "prompt": "Summarize",
        "secret": "must-not-be-forwarded", "script": "must-not-be-forwarded"
    }))
    .unwrap();
    assert_eq!(
        body,
        json!({
            "name": "github-push", "description": "source", "events": ["push"],
            "deliver": "log", "deliver_only": false, "prompt": "Summarize"
        })
    );
    assert!(
        creation_body(&json!({"name":"x","events":[],"deliver":"log","deliver_only":true}))
            .is_err()
    );
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_webhook_request_shapes() {
    let payload = json!({"name":"native-shape-test","description":"test","events":["push"],"deliver":"log","deliver_only":false,"prompt":"summarize"});
    for (operation, input) in [
        ("webhooks.list", json!({})),
        ("webhooks.create", payload),
        (
            "webhooks.toggle",
            json!({"name":"native-shape-test","enabled":false}),
        ),
        ("webhooks.delete", json!({"name":"native-shape-test"})),
    ] {
        let (method, path, body) = request_shape("default", operation, &input).unwrap();
        println!(
            "WEBHOOK_SHAPE={}",
            json!({"operation":operation,"method":method.as_str(),"path":path,"body":body})
        );
    }
}
