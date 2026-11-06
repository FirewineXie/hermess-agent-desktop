use super::{create_payload, validate_builder_options, ProfileCreateOptions};
use serde_json::{json, Value};

fn options(value: Value) -> ProfileCreateOptions {
    serde_json::from_value(value).unwrap()
}

#[test]
fn builder_accepts_locked_dashboard_fields() {
    let value = options(json!({
        "provider":"openrouter", "model":"openai/gpt-4.1-mini",
        "keepSkills":["hermes-agent"], "hubSkills":["owner/repository/skill"],
        "mcpServers":[{"name":"public-docs","url":"https://example.com/mcp","auth":"none"},
            {"name":"local-tool","command":"node","args":["server.js"],"env":{"API_KEY":"secret"}}]
    }));
    validate_builder_options(&value).unwrap();
    let payload = create_payload("builder", Some(&value), None);
    assert_eq!(payload["provider"], "openrouter");
    assert_eq!(payload["keep_skills"], json!(["hermes-agent"]));
    assert_eq!(payload["hub_skills"], json!(["owner/repository/skill"]));
    assert_eq!(payload["mcp_servers"].as_array().unwrap().len(), 2);
    assert!(payload.get("keepSkills").is_none());
}

#[test]
fn builder_rejects_ambiguous_or_unsafe_fields() {
    for value in [
        json!({"provider":"openrouter"}),
        json!({"model":"openai/gpt-4.1-mini"}),
        json!({"noSkills":true,"keepSkills":["hermes-agent"]}),
        json!({"noSkills":true,"cloneFrom":"default"}),
        json!({"mcpServers":[{"name":"bad","url":"file:///tmp/server"}]}),
        json!({"mcpServers":[{"name":"bad","url":"https://example.com","command":"node"}]}),
        json!({"mcpServers":[{"name":"bad","url":"https://example.com","auth":"header"}]}),
        json!({"mcpServers":[{"name":"bad","command":"node","env":{"BAD-KEY":"secret"}}]}),
    ] {
        assert!(validate_builder_options(&options(value)).is_err());
    }
}

#[test]
#[ignore = "prints the production-compatible create body for the locked receiver test"]
fn print_production_profile_builder_shapes() {
    let full = options(json!({
        "provider":"openrouter", "model":"openai/gpt-4.1-mini",
        "keepSkills":["hermes-agent"], "hubSkills":["owner/repository/skill"],
        "mcpServers":[{"name":"public-docs","url":"https://example.com/mcp","auth":"none"}]
    }));
    let no_skills = options(json!({"noSkills":true}));
    for (name, value) in [("builder_full", full), ("builder_empty", no_skills)] {
        validate_builder_options(&value).unwrap();
        println!(
            "PROFILE_BUILDER_SHAPE={}",
            create_payload(name, Some(&value), None)
        );
    }
}
