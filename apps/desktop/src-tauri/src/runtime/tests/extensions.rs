use super::prepare_mcp_update;
use serde_json::json;

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
