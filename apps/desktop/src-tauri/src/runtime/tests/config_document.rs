use super::{documents_match, parse_document, replace_field};
use serde_json::json;

#[test]
fn yaml_requires_a_mapping_and_rejects_duplicate_keys() {
    assert!(parse_document("agent:\n  max_turns: 2\n").is_ok());
    for text in [
        "- one\n- two",
        "agent: [",
        "agent: 1\nagent: 2\n",
        "agent:\n  limit: 1\n  limit: 2\n",
    ] {
        assert!(
            parse_document(text).is_err(),
            "invalid document was accepted"
        );
    }
    assert!(parse_document(&format!("value: {}", "x".repeat(super::MAX_DOCUMENT_BYTES))).is_err());
}

#[test]
fn object_replacement_removes_keys_and_preserves_unrelated_sections() {
    let mut source = json!({"agent":{"reasoning_overrides":{"old":"high","kept":"low"}},"other":{"unknown":true}});
    replace_field(
        &mut source,
        "agent.reasoning_overrides",
        json!({"kept":"low"}),
    )
    .unwrap();
    assert_eq!(
        source["agent"]["reasoning_overrides"],
        json!({"kept":"low"})
    );
    assert_eq!(source["other"], json!({"unknown":true}));
}

#[test]
fn readback_compares_values_and_resolves_stripped_defaults() {
    let defaults = json!({"agent":{"max_turns":10,"other":true},"empty":{}});
    let expected = json!({"agent":{"max_turns":10},"custom":{"value":null}});
    let stripped = json!({"custom":{"value":null}});
    assert!(documents_match(&expected, &stripped, &defaults));
    assert!(!documents_match(&expected, &json!({}), &defaults));
    assert!(!documents_match(
        &json!({"x":{"keep":1}}),
        &json!({"x":{"keep":1,"deleted":2}}),
        &defaults
    ));
}
