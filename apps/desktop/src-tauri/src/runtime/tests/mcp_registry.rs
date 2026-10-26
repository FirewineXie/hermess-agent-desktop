use super::{detail_url, entry, valid_name};
use serde_json::json;

#[test]
fn registry_entries_only_auto_install_plain_https_remotes() {
    let plain = json!({"server": {
        "name": "example.org/plain", "version": "1.0", "title": "Plain",
        "remotes": [{"type": "streamable-http", "url": "https://mcp.example.org/mcp"}]
    }});
    let result = entry(&plain).unwrap();
    assert_eq!(result["url"], "https://mcp.example.org/mcp");
    assert_eq!(result["installable"], true);

    let templated = json!({"server": {
        "name": "example.org/secret", "version": "1.0",
        "remotes": [{"type": "streamable-http", "url": "https://mcp.example.org/mcp",
            "headers": [{"name": "Authorization", "value": "Bearer {token}"}]}]
    }});
    assert_eq!(entry(&templated).unwrap()["installable"], false);

    let local = json!({"server": {
        "name": "example.org/local", "version": "1.0",
        "packages": [{"registryType": "npm", "identifier": "example-mcp"}]
    }});
    assert_eq!(entry(&local).unwrap()["installable"], false);

    let insecure = json!({"server": {
        "name": "example.org/insecure", "version": "1.0",
        "remotes": [{"type": "streamable-http", "url": "http://mcp.example.org/mcp"}]
    }});
    assert_eq!(entry(&insecure).unwrap()["installable"], false);
}

#[test]
fn registry_names_are_bounded_before_building_detail_urls() {
    assert!(valid_name("io.github.owner/server"));
    assert!(!valid_name("../server"));
    assert!(!valid_name("owner/server?cursor=other"));
    assert!(!valid_name(&format!("owner/{}", "a".repeat(200))));
    assert_eq!(
        detail_url("ai.fetchfido/fido").unwrap().as_str(),
        "https://registry.modelcontextprotocol.io/v0.1/servers/ai.fetchfido%2Ffido/versions/latest"
    );
}
