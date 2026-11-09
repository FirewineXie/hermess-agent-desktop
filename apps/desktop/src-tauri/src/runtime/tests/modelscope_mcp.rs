use super::{detail_url, entry, server_id, setup_options};
use serde_json::json;

#[test]
fn modelscope_mcp_ids_and_details_use_the_public_path() {
    assert_eq!(
        server_id("modelscope-mcp:@amap/amap-maps").unwrap(),
        "@amap/amap-maps"
    );
    assert!(server_id("modelscope-mcp:../other").is_err());
    assert!(server_id("modelscope-mcp:@amap/maps/other").is_err());
    assert_eq!(
        detail_url("modelscope-mcp:@amap/amap-maps")
            .unwrap()
            .as_str(),
        "https://www.modelscope.cn/openapi/v1/mcp/servers/@amap/amap-maps"
    );
}

#[test]
fn hosted_templates_and_local_commands_are_manual_only() {
    let local = json!({
        "id": "@amap/amap-maps", "name": "高德地图",
        "server_config": [{"mcpServers": {"amap": {
            "command": "npx", "args": ["-y", "@amap/amap-maps-mcp-server"],
            "env": {"AMAP_MAPS_API_KEY": ""}
        }}}],
        "operational_urls": []
    });
    let item = entry(&local).unwrap();
    assert_eq!(item["installable"], false);
    assert_eq!(item["package_hint"], "npx -y @amap/amap-maps-mcp-server");
    assert_eq!(
        item["catalog_url"],
        "https://www.modelscope.cn/mcp/servers/@amap/amap-maps"
    );

    let template = json!({
        "id": "owner/hosted", "server_config": [{"mcpServers": {"hosted": {
            "url": "https://example.org/{uuid}/mcp"
        }}}]
    });
    assert_eq!(entry(&template).unwrap()["installable"], false);

    let plain = json!({
        "id": "owner/plain", "server_config": [{"mcpServers": {"plain": {
            "url": "https://example.org/mcp"
        }}}]
    });
    let item = entry(&plain).unwrap();
    assert_eq!(item["installable"], true);
    assert_eq!(item["url"], "https://example.org/mcp");
    assert!(item["install_name"]
        .as_str()
        .unwrap()
        .starts_with("ms-owner-plain-"));

    let mixed = json!({
        "id": "owner/mixed", "server_config": [{"mcpServers": {
            "this-server": {"url": "https://example.org/mcp"},
            "unrelated-server": {"url": "https://other.example.org/mcp"}
        }}]
    });
    assert_eq!(entry(&mixed).unwrap()["installable"], false);
}

#[tokio::test]
#[ignore = "requires public ModelScope network"]
async fn live_public_modelscope_mcp_search_and_preview() {
    let listing = super::search("amap-maps").await.unwrap();
    let entries = listing["entries"].as_array().unwrap();
    let item = entries
        .iter()
        .find(|item| item["identifier"] == "modelscope-mcp:@amap/amap-maps")
        .unwrap();
    assert_eq!(item["source"], "modelscope");
    assert!(item.get("setup_options").is_none());
    let detail = super::preview("modelscope-mcp:@amap/amap-maps")
        .await
        .unwrap();
    assert_eq!(detail["identifier"], item["identifier"]);
    assert_eq!(detail["installable"], false);
    assert!(detail["setup_options"]
        .as_array()
        .unwrap()
        .iter()
        .any(|option| {
            option["transport"] == "stdio"
                && option["command"] == "npx"
                && option["env_keys"] == json!(["AMAP_MAPS_API_KEY"])
        }));
    let bing = super::preview("modelscope-mcp:slcatwujian/bing-cn-mcp-server")
        .await
        .unwrap();
    assert!(bing["setup_options"]
        .as_array()
        .unwrap()
        .iter()
        .any(|option| {
            option["command"] == "cmd"
                && option["args"] == json!(["/c", "npx", "-y", "bing-cn-mcp"])
        }));
    let xsct = super::preview("modelscope-mcp:itshen/xsct-bench")
        .await
        .unwrap();
    assert_eq!(xsct["setup_options"], json!([]));
}

#[test]
fn setup_options_only_project_settings_the_manual_form_can_represent() {
    let detail = json!({"server_config": [
        {"mcpServers": {"local": {"command": "cmd", "args": ["/c", "value with spaces"], "env": {"API_KEY": "example-value"}}}},
        {"mcpServers": {"remote": {"url": "https://example.org/mcp"}}},
        {"mcpServers": {"invalid-args": {"command": "node", "args": [""]}}},
        {"mcpServers": {"mixed": {"command": "node", "url": "https://example.org/mcp"}}},
        {"mcpServers": {"with-token": {"url": "https://example.org/mcp?token=example-value"}}},
        {"mcpServers": {"with-headers": {"url": "https://example.org/mcp", "headers": {"Authorization": "example-value"}}}}
    ]});
    assert_eq!(
        setup_options(&detail),
        vec![
            json!({"transport": "stdio", "command": "cmd", "args": ["/c", "value with spaces"], "env_keys": ["API_KEY"]}),
            json!({"transport": "http", "url": "https://example.org/mcp"}),
        ]
    );
}
