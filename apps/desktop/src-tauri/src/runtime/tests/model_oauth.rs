use super::{project_poll, project_providers, project_start, request_shape};
use serde_json::json;

#[test]
fn oauth_request_shapes_bind_every_operation_to_the_profile() {
    let cases = [
        (
            "list",
            None,
            None,
            "GET",
            "/api/providers/oauth?profile=worker",
        ),
        (
            "start",
            Some("openai-codex"),
            None,
            "POST",
            "/api/providers/oauth/openai-codex/start?profile=worker",
        ),
        (
            "poll",
            Some("openai-codex"),
            Some("session_1"),
            "GET",
            "/api/providers/oauth/openai-codex/poll/session_1?profile=worker",
        ),
        (
            "cancel",
            None,
            Some("session_1"),
            "DELETE",
            "/api/providers/oauth/sessions/session_1?profile=worker",
        ),
        (
            "disconnect",
            Some("openai-codex"),
            None,
            "DELETE",
            "/api/providers/oauth/openai-codex?profile=worker",
        ),
    ];
    for (operation, provider, session, method, path) in cases {
        let (actual_method, actual_path, _) =
            request_shape("worker", operation, provider, session).unwrap();
        assert_eq!(actual_method.as_str(), method);
        assert_eq!(actual_path, path);
    }
    assert!(request_shape("worker", "poll", Some("../bad"), Some("ok")).is_err());
    assert!(request_shape("worker", "cancel", None, Some("bad/session")).is_err());
    assert!(request_shape("worker", "start", Some("nous"), None).is_err());
}

#[test]
fn oauth_receiver_values_are_bounded_and_safe_for_the_webview() {
    let providers = project_providers(json!({"providers":[{
        "id":"nous","name":"Nous Portal","flow":"device_code",
        "cli_command":"","docs_url":"https://portal.nousresearch.com/",
        "disconnect_hint":null,"disconnect_command":null,"disconnectable":true,
        "status":{"logged_in":false,"has_refresh_token":false}
    },{
        "id":"openai-codex","name":"Codex","flow":"device_code",
        "cli_command":"hermes auth add openai-codex","docs_url":"https://example.com/docs",
        "disconnect_hint":null,"disconnect_command":null,"disconnectable":true,
        "status":{"logged_in":true,"token_preview":"…secret","has_refresh_token":false}
    }]}))
    .unwrap();
    assert_eq!(providers.providers.len(), 1);
    assert_eq!(providers.providers[0].id, "openai-codex");
    assert!(project_providers(json!({"providers":[{
        "id":"bad/path","name":"Bad","flow":"device_code","cli_command":"",
        "docs_url":"javascript:alert(1)","status":{"logged_in":false}
    }]}))
    .is_err());

    let start = project_start(json!({
        "session_id":"session_1","flow":"device_code","user_code":"ABCD-EFGH",
        "verification_url":"https://example.com/device","expires_in":900,"poll_interval":5
    }))
    .unwrap();
    assert_eq!(start.session_id, "session_1");
    assert!(project_start(json!({
        "session_id":"session_1","flow":"device_code","user_code":"ABCD",
        "verification_url":"http://example.com/device","expires_in":900,"poll_interval":5
    }))
    .is_err());

    let poll = project_poll(json!({
        "session_id":"session_1","status":"pending","error_message":null,"expires_at":1700000000
    }))
    .unwrap();
    assert_eq!(poll.status, "pending");
    assert!(project_poll(json!({"session_id":"session_1","status":"unknown"})).is_err());
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_model_oauth_request_shapes() {
    for (operation, provider, session) in [
        ("list", None, None),
        ("start", Some("unknown-provider"), None),
        ("poll", Some("openai-codex"), Some("missing-session")),
        ("cancel", None, Some("missing-session")),
        ("disconnect", Some("unknown-provider"), None),
    ] {
        let (method, path, body) = request_shape("default", operation, provider, session).unwrap();
        println!(
            "MODEL_OAUTH_SHAPE={}",
            json!({
                "operation":operation,"method":method.as_str(),"path":path,"body":body
            })
        );
    }
}
