use super::{agent_error_category, catalog, valid_plugin_name};

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
fn bundled_catalog_is_pinned_and_has_unique_names() {
    let snapshot = catalog().expect("catalog JSON");
    assert!(snapshot["sourceCommit"]
        .as_str()
        .is_some_and(|sha| sha.len() == 40));
    let entries = snapshot["entries"].as_array().expect("entries");
    assert!(!entries.is_empty());
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        let name = entry["name"].as_str().expect("name");
        assert!(seen.insert(name), "duplicate {name}");
        assert!(entry["sha"].as_str().is_some_and(|sha| sha.len() == 40));
    }
}
