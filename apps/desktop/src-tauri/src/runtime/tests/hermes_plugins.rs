use super::{
    agent_error_category, catalog_install_body, context_engine_write_request,
    current_catalog_entry, custom_install_body, plugin_mutation_request, safe_scan_findings,
    valid_context_engine, valid_plugin_identifier, valid_plugin_name,
};
use serde_json::json;

#[test]
fn agent_error_logs_only_static_category() {
    assert_eq!(
        agent_error_category(br#"{"detail":"Plugin already installed at C:\\secret\\path"}"#),
        "already_installed"
    );
    assert_eq!(
        agent_error_category(br#"{"detail":"private-token-value"}"#),
        "other"
    );
}

#[test]
fn plugin_routes_reject_path_and_query_injection() {
    assert!(valid_plugin_name("web/firecrawl"));
    assert!(valid_plugin_name("hermes-session-reset-policy"));
    for name in [
        "",
        "/plugin",
        "plugin/",
        "plugin//other",
        "../plugin",
        "plugin?x=1",
        "plugin\\other",
        "plugin%2Fother",
    ] {
        assert!(!valid_plugin_name(name), "{name}");
    }
}

#[test]
fn live_catalog_requires_the_displayed_pin_and_rejects_removed_entries() {
    let sha = "a".repeat(40);
    let catalog = json!({"entries":[{"name":"openviking", "sha":sha,
        "repo":"https://github.com/volcengine/OpenViking", "platforms":[]}], "removed":[]});
    let shown = json!({"sha":sha, "repo":"https://github.com/volcengine/OpenViking"});
    assert!(current_catalog_entry(&catalog, "openviking", &shown).is_ok());
    assert!(current_catalog_entry(
        &catalog,
        "openviking",
        &json!({"sha":"b".repeat(40), "repo":shown["repo"]})
    )
    .is_err());
    let removed = json!({"entries":catalog["entries"], "removed":[{"name":"openviking"}]});
    assert!(current_catalog_entry(&removed, "openviking", &shown).is_err());
}

#[test]
fn plugin_install_shapes_keep_custom_sources_bounded_and_catalogs_disabled_by_default() {
    for identifier in [
        "owner/repo",
        "owner/repo/plugins/example",
        "https://github.com/owner/repo.git",
    ] {
        assert!(valid_plugin_identifier(identifier), "{identifier}");
    }
    for identifier in [
        "http://example.com/repo",
        "https://user:secret@example.com/repo",
        "owner/../repo",
        "owner\\repo",
        "owner/repo?ref=main",
    ] {
        assert!(!valid_plugin_identifier(identifier), "{identifier}");
    }
    assert_eq!(
        custom_install_body(&json!({
            "identifier":"owner/repo/subdir", "force":true, "enable":true
        }))
        .expect("custom install")
        .expect("custom body"),
        json!({"identifier":"owner/repo/subdir", "force":true, "enable":true})
    );
    assert_eq!(
        catalog_install_body("catalog-plugin", &json!("a".repeat(40)), &json!({}))
            .expect("catalog body"),
        json!({
            "identifier":"", "catalog_name":"catalog-plugin", "ref":"a".repeat(40),
            "enable":false
        })
    );
}

#[test]
fn context_engine_write_shape_is_exact_and_bounded() {
    assert!(valid_context_engine("snapcompact-v2"));
    assert!(!valid_context_engine("../engine"));
    let (method, route, body) =
        context_engine_write_request("snapcompact-v2").expect("context engine shape");
    assert_eq!(method, reqwest::Method::PUT);
    assert_eq!(route, "/api/dashboard/plugin-providers");
    assert_eq!(body, json!({"context_engine":"snapcompact-v2"}));
}

#[test]
fn update_and_visibility_shapes_are_bounded() {
    let (method, path, body) = plugin_mutation_request(
        "hermesPlugins.update",
        "safe-plugin",
        &json!({"accept_capabilities": true, "force": true}),
    )
    .expect("update shape");
    assert_eq!(method, reqwest::Method::POST);
    assert_eq!(path, "/api/dashboard/agent-plugins/safe-plugin/update");
    assert_eq!(
        body,
        Some(json!({"accept_capabilities": true, "force": true}))
    );

    let (_, path, body) = plugin_mutation_request(
        "hermesPlugins.visibility",
        "safe-plugin",
        &json!({"hidden": true}),
    )
    .expect("visibility shape");
    assert_eq!(path, "/api/dashboard/plugins/safe-plugin/visibility");
    assert_eq!(body, Some(json!({"hidden": true})));
    assert!(plugin_mutation_request(
        "hermesPlugins.visibility",
        "../unsafe",
        &json!({"hidden": true})
    )
    .is_err());
}

#[test]
fn scan_findings_drop_absolute_or_unbounded_content() {
    let findings = safe_scan_findings(Some(&json!([
        {"severity":"medium","category":"shell","file":"src/check.py","line":12,"description":"Review shell use"},
        {"severity":"high","category":"secret","file":"C:\\private\\token.txt","line":1,"description":"must not escape"},
        {"severity":"low","category":"noise","file":"src/noise.py","line":1,"description":"x".repeat(1001)},
    ])));
    assert_eq!(
        findings,
        vec![json!({
            "severity":"medium", "category":"shell", "file":"src/check.py",
            "line":12, "description":"Review shell use"
        })]
    );
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_plugin_management_shapes() {
    println!(
        "PLUGIN_SHAPE={}",
        json!({
            "method": "GET",
            "path": "/api/dashboard/plugins/hub"
        })
    );
    for (operation, payload) in [
        ("hermesPlugins.visibility", json!({"hidden": true})),
        (
            "hermesPlugins.update",
            json!({"accept_capabilities": false, "force": true}),
        ),
    ] {
        let (method, path, body) =
            plugin_mutation_request(operation, "desktop-fixture", &payload).expect("shape");
        println!(
            "PLUGIN_SHAPE={}",
            json!({
                "method": method.as_str(),
                "path": path,
                "body": body,
            })
        );
    }
    let custom = custom_install_body(&json!({
        "identifier":"owner/repo/subdir", "force":false, "enable":true
    }))
    .expect("custom install shape")
    .expect("custom install body");
    println!(
        "PLUGIN_SHAPE={}",
        json!({
            "method":"POST", "path":"/api/dashboard/agent-plugins/install", "body":custom
        })
    );
    let (method, path, body) =
        context_engine_write_request("desktop-context").expect("context engine shape");
    println!(
        "PLUGIN_SHAPE={}",
        json!({"method":method.as_str(), "path":path, "body":body})
    );
}
#[test]
#[ignore = "run by the isolated locked Gateway receiver probe"]
fn print_production_gateway_feature_plugins() {
    println!(
        "FEATURE_SHAPE={}",
        serde_json::json!({"id": "plugin-batch", "method": "POST", "path": super::batch::UPDATE_ALL})
    );
    println!(
        "FEATURE_SHAPE={}",
        json!({"id":"plugin-auto-read", "method":"GET", "path":super::batch::AUTO_UPDATE})
    );
    for (id, enabled) in [("plugin-auto-enable", true), ("plugin-auto-disable", false)] {
        let body = super::batch::auto_update_body(&json!({"enabled":enabled})).unwrap();
        println!(
            "FEATURE_SHAPE={}",
            json!({"id":id, "method":"PUT", "path":super::batch::AUTO_UPDATE, "body":body})
        );
    }
}
