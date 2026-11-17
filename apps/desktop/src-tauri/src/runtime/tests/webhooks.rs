use super::{creation_body, name, named_request, request_shape};
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
fn shared_subscriptions_keep_profile_ownership_and_signing_secret() {
    let home = tempfile::tempdir().unwrap();
    let payload = json!({"name":"profile-event","events":["push"],"deliver":"log"});
    let created = named_request(
        home.path(),
        "research",
        "webhooks.create",
        &payload,
        "http://localhost:8644",
    )
    .unwrap();
    assert_eq!(
        created["url"],
        "http://localhost:8644/p/research/webhooks/profile-event"
    );
    assert!(created["secret"].as_str().unwrap().len() >= 32);
    let raw: serde_json::Value = serde_json::from_slice(
        &std::fs::read(home.path().join("webhook_subscriptions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(raw["profile-event"]["profile"], "research");
    assert_eq!(raw["profile-event"]["secret"], created["secret"]);
    assert!(named_request(
        home.path(),
        "default",
        "webhooks.delete",
        &json!({"name":"profile-event"}),
        "http://localhost:8644"
    )
    .is_err());
    assert!(named_request(
        home.path(),
        "default",
        "webhooks.list",
        &json!({}),
        "http://localhost:8644"
    )
    .unwrap()["subscriptions"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        named_request(
            home.path(),
            "research",
            "webhooks.list",
            &json!({}),
            "http://localhost:8644"
        )
        .unwrap()["subscriptions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(named_request(
        home.path(),
        "default",
        "webhooks.create",
        &payload,
        "http://localhost:8644"
    )
    .is_err());
    named_request(
        home.path(),
        "research",
        "webhooks.toggle",
        &json!({"name":"profile-event","enabled":false}),
        "http://localhost:8644",
    )
    .unwrap();
    let listed = named_request(
        home.path(),
        "research",
        "webhooks.list",
        &json!({}),
        "http://localhost:8644",
    )
    .unwrap();
    assert_eq!(listed["subscriptions"][0]["enabled"], false);
    named_request(
        home.path(),
        "research",
        "webhooks.delete",
        &json!({"name":"profile-event"}),
        "http://localhost:8644",
    )
    .unwrap();
    assert!(named_request(
        home.path(),
        "research",
        "webhooks.list",
        &json!({}),
        "http://localhost:8644"
    )
    .unwrap()["subscriptions"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
#[ignore = "run by the isolated locked Webhook receiver probe"]
fn print_production_named_webhook_record() {
    let home = tempfile::tempdir().unwrap();
    let created = named_request(
        home.path(),
        "research",
        "webhooks.create",
        &json!({"name":"profile-event","events":["push"],"deliver":"log"}),
        "http://localhost:8644",
    )
    .unwrap();
    let stored: serde_json::Value = serde_json::from_slice(
        &std::fs::read(home.path().join("webhook_subscriptions.json")).unwrap(),
    )
    .unwrap();
    println!(
        "NAMED_WEBHOOK_RECORD={}",
        json!({"created":created,"stored":stored})
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
