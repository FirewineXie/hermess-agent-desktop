use serde_json::json;

use super::{authorization_url, operation_params, response_params, retry_params, Answer};
use crate::runtime::profiles::scoped_params;

#[test]
fn authorization_only_opens_web_urls_without_embedded_credentials() {
    assert!(authorization_url("https://example.test/oauth?state=secret").is_some());
    assert!(authorization_url("http://127.0.0.1:1234/oauth").is_some());
    assert!(authorization_url("https://user:secret@example.test").is_none());
    assert!(authorization_url("http://example.test/oauth").is_none());
    assert!(authorization_url("javascript:alert(1)").is_none());
}

#[test]
fn production_chat_connection_requests() {
    let answer: Answer = serde_json::from_value(json!({
        "targets": [{"name": "linear", "status": "skipped"}]
    }))
    .unwrap();
    let status = operation_params("fixture-session", "fixture-op");
    let respond = response_params("fixture-session", "fixture-op", &answer).unwrap();
    let retry = retry_params("fixture-session", "linear");
    assert_eq!(respond["owner"], status["owner"]);
    assert_eq!(respond["op_id"], status["op_id"]);
    assert_eq!(retry["owner"], status["owner"]);
    let respond_named = scoped_params("reviewer", "connection.respond", respond.clone()).unwrap();
    let approval: Answer = serde_json::from_value(json!({
        "targets": [{"name": "openviking", "status": "approved"}]
    }))
    .unwrap();
    let approve = response_params("fixture-session", "fixture-op", &approval).unwrap();
    println!(
        "CHAT_CONNECTION_WIRE={}",
        json!({
        "status": status, "respond": respond, "retry": retry, "respond_named": respond_named, "approve": approve
        })
    );
}

#[test]
fn credentials_cannot_override_catalog_install_options() {
    let allowed: Answer = serde_json::from_value(json!({
        "targets": [{"name": "fixture", "status": "approved", "env": {"API_TOKEN": "test-token"}}]
    }))
    .unwrap();
    assert!(response_params("fixture-session", "fixture-op", &allowed).is_ok());
    for key in [
        "target_profile",
        "agent_half",
        "desktop_half",
        "enable",
        "force",
        "ref",
    ] {
        let answer: Answer = serde_json::from_value(json!({
            "targets": [{"name": "fixture", "status": "approved", "env": {(key): "override"}}]
        }))
        .unwrap();
        assert!(response_params("fixture-session", "fixture-op", &answer).is_err());
    }
}
