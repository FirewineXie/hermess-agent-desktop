use super::{
    memory_provider_request_shape, prepare_mcp_update, review_capability_value,
    upstream_request_target,
};
use serde_json::json;

#[test]
fn review_capability_uses_profile_configuration_and_bundle_mode() {
    let listed = json!([{"name": "sdlc-review", "enabled": true}]);
    assert_eq!(
        review_capability_value(&listed, &json!({}), true).unwrap(),
        json!({"capability": "ready", "reason": "listed"})
    );

    let disabled = json!({"skills": {"disabled": ["sdlc-review"]}});
    assert_eq!(
        review_capability_value(&json!([]), &disabled, false).unwrap(),
        json!({"capability": "missing", "reason": "disabled"})
    );
    assert_eq!(
        review_capability_value(&json!([]), &json!({}), true).unwrap(),
        json!({"capability": "missing", "reason": "bundled_skills_omitted"})
    );
    assert_eq!(
        review_capability_value(&json!([]), &json!({}), false).unwrap(),
        json!({"capability": "ready", "reason": "bundled"})
    );
}

#[test]
#[ignore]
fn print_production_toolset_shapes() {
    for (operation, body) in [
        ("toolsets.config", json!({"name": "web"})),
        (
            "toolsets.provider",
            json!({"name": "web", "provider": "invalid-provider", "capability": "search"}),
        ),
        (
            "toolsets.env",
            json!({"name": "web", "env": {"INVALID_TEST_KEY": "value"}}),
        ),
    ] {
        let (method, url) = upstream_request_target(1421, operation, &body).unwrap();
        println!(
            "TOOLSET_SHAPE={}",
            json!({"operation": operation, "method": method.as_str(), "path": url.path(), "body": body})
        );
    }
}

#[test]
fn mcp_edit_keeps_hidden_settings_and_other_servers() {
    let config = json!({ "mcp_servers": {
        "context7": {
            "url": "https://old.example/mcp",
            "headers": { "Authorization": "Bearer ${MCP_CONTEXT7_TOKEN}" },
            "enabled": false,
            "tools": ["search"]
        },
        "local": { "command": "node", "args": ["server.js"], "env": { "KEY": "${KEY}" } }
    }});
    let updated = prepare_mcp_update(
        &config,
        &json!({
            "name": "context7", "url": "https://new.example/mcp"
        }),
    )
    .unwrap();
    assert_eq!(updated["context7"]["url"], "https://new.example/mcp");
    assert_eq!(
        updated["context7"]["headers"],
        config["mcp_servers"]["context7"]["headers"]
    );
    assert_eq!(updated["context7"]["enabled"], false);
    assert_eq!(updated["context7"]["tools"], json!(["search"]));
    assert_eq!(updated["local"], config["mcp_servers"]["local"]);
}

#[test]
fn mcp_edit_rejects_transport_switch() {
    let config = json!({ "mcp_servers": { "context7": { "url": "https://old.example/mcp" } } });
    assert!(prepare_mcp_update(
        &config,
        &json!({
            "name": "context7", "command": "node", "args": ["server.js"]
        })
    )
    .is_err());
}

#[test]
fn mcp_oauth_cancel_shape_is_delete_with_a_bounded_flow_id() {
    let (method, url) =
        upstream_request_target(1421, "mcp.auth.cancel", &json!({"flow_id": "flow-1"})).unwrap();
    assert_eq!(method, reqwest::Method::DELETE);
    assert_eq!(url.path(), "/api/mcp/oauth/flows/flow-1");
    assert!(url.query().is_none());

    assert!(
        upstream_request_target(1421, "mcp.auth.cancel", &json!({"flow_id": "bad\nflow"})).is_err()
    );
    assert!(upstream_request_target(
        1421,
        "mcp.auth.cancel",
        &json!({"flow_id": "x".repeat(201)})
    )
    .is_err());
}

#[test]
fn memory_provider_activation_shape_is_exact_and_profile_scoped() {
    let (method, path, body) =
        memory_provider_request_shape("writer", &json!({"provider": "openviking"})).unwrap();
    assert_eq!(method, reqwest::Method::PUT);
    assert_eq!(path, "/api/memory/provider?profile=writer");
    assert_eq!(body, json!({"provider": "openviking"}));

    let (_, _, builtin) =
        memory_provider_request_shape("writer", &json!({"provider": ""})).unwrap();
    assert_eq!(builtin, json!({"provider": ""}));
    assert!(memory_provider_request_shape("writer", &json!({"provider": "bad\nname"})).is_err());
    assert!(memory_provider_request_shape("writer", &json!({"provider": "../other"})).is_err());
}

#[test]
#[ignore]
fn print_production_memory_provider_shapes() {
    for provider in ["", "missing-provider"] {
        let (method, path, body) =
            memory_provider_request_shape("default", &json!({"provider": provider})).unwrap();
        println!(
            "MEMORY_PROVIDER_SHAPE={}",
            json!({"method": method.as_str(), "path": path, "body": body})
        );
    }
}
