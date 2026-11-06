use super::{
    conflicts, copied_key_env, env_reference, raw_endpoint, template, verified_public_fields,
};
use serde_json::json;

#[test]
fn refuses_id_name_and_normalized_url_conflicts() {
    let source = json!({"id":"source","name":"Example","base_url":"https://example.test/v1/"});
    for target in [
        json!({"id":"source"}),
        json!({"name":"example"}),
        json!({"base_url":"https://EXAMPLE.test/v1"}),
    ] {
        assert!(conflicts(&source, &target));
    }
    assert!(!conflicts(
        &source,
        &json!({"id":"different","name":"Other","base_url":"https://other.test/v1"})
    ));
}

#[test]
fn builds_copy_template_without_exposing_credentials_or_activation() {
    let source = json!({"id":"source","name":"Example","base_url":"https://example.test/v1","model":"one","models":["one"],"api_key":"must-not-copy","key_env":"SECRET","api_mode":"anthropic_messages","context_length":65536});
    let body = template(&source, vec!["one".into(), "two".into()]).unwrap();
    assert_eq!(body["api_key"], "");
    assert!(body.get("key_env").is_none());
    assert!(body.get("id").is_none());
    assert_eq!(body["make_default"], false);
    assert_eq!(body["models"], json!(["one", "two"]));
    assert_eq!(body["context_length"], 65536);
    assert_eq!(body["api_mode"], "anthropic_messages");
    assert!(template(&json!({"source":"direct-config"}), vec![]).is_err());
}

#[test]
fn verification_requires_the_runtime_catalogue_and_known_empty_credentials() {
    let body = template(
        &json!({"id":"source","name":"Example","base_url":"https://example.test/v1","model":"one"}),
        vec!["one".into(), "two".into()],
    )
    .unwrap();
    let mut actual = body.clone();
    actual["has_api_key"] = json!(false);
    assert!(verified_public_fields(&actual, &body));
    actual["models"] = json!(["one"]);
    assert!(!verified_public_fields(&actual, &body));
    actual["models"] = json!(["two", "one"]);
    actual.as_object_mut().unwrap().remove("has_api_key");
    assert!(!verified_public_fields(&actual, &body));
    let mut keyed = body.clone();
    keyed["api_key"] = json!("test-secret");
    actual["has_api_key"] = json!(true);
    assert!(verified_public_fields(&actual, &keyed));
    actual["has_api_key"] = json!(false);
    assert!(!verified_public_fields(&actual, &keyed));
}

#[test]
fn resolves_only_the_selected_raw_provider_entry() {
    let config = json!({"providers":{"one":{"api_key":"first"}},"custom_providers":[{"name":"Legacy","base_url":"https://legacy.test/v1","api_key":"second"}]});
    assert_eq!(
        raw_endpoint(&config, &json!({"id":"one","source":"providers"})).unwrap()["api_key"],
        "first"
    );
    assert_eq!(raw_endpoint(&config, &json!({"id":"legacy","name":"Legacy","base_url":"https://legacy.test/v1","source":"custom_providers"})).unwrap()["api_key"], "second");
    assert!(raw_endpoint(&config, &json!({"id":"other","source":"providers"})).is_none());
    assert_eq!(env_reference("${PROVIDER_KEY}"), Some("PROVIDER_KEY"));
    assert_eq!(env_reference("masked-secret"), None);
    assert_eq!(
        copied_key_env("copy-1234-abcd"),
        "HERMES_CUSTOM_COPY_1234_ABCD_API_KEY"
    );
}
