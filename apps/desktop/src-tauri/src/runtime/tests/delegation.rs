use super::{prepare_model_map, public_routing};
use serde_json::json;

#[test]
fn keeps_renamed_credentials_in_host_and_redacts_output() {
    let current = json!({"model_map":{"options":[{"name":"old","api_key":"masked-preview"}]}});
    let draft = json!({"model_map":{"options":[{"name":"new","original_name":"old","description":"task","provider":"test","model":"one","has_api_key":true,"credential":{"action":"keep"}}]}});
    let body = prepare_model_map(&draft, &current).unwrap();
    assert_eq!(body["options"][0]["api_key"], "masked-preview");
    assert_eq!(body["options"][0]["original_name"], "old");
    assert!(body["options"][0].get("credential").is_none());
    let result = public_routing(json!({"model_map":body}));
    assert!(result.pointer("/model_map/options/0/api_key").is_none());
    assert_eq!(
        result.pointer("/model_map/options/0/has_api_key"),
        Some(&json!(true))
    );
}

#[test]
fn explicit_clear_and_replace_and_validation() {
    let mut draft = json!({"model_map":{"options":[{"name":"one","description":"task","provider":"test","model":"one","credential":{"action":"replace","value":"new-key"}}]}});
    assert_eq!(
        prepare_model_map(&draft, &json!({})).unwrap()["options"][0]["api_key"],
        "new-key"
    );
    draft["model_map"]["options"][0]["credential"] = json!({"action":"clear"});
    assert_eq!(
        prepare_model_map(&draft, &json!({})).unwrap()["options"][0]["api_key"],
        ""
    );
    draft["model_map"]["options"][0]["base_url"] = json!("file:///tmp/test");
    assert!(prepare_model_map(&draft, &json!({})).is_err());
}

#[test]
fn a_new_route_does_not_inherit_a_deleted_same_name_routes_credential() {
    let current = json!({"model_map":{"options":[{"name":"same","api_key":"masked-existing"}]}});
    let draft = json!({"model_map":{"options":[{"name":"same","description":"new task","provider":"new","model":"one"}]}});
    assert_eq!(
        prepare_model_map(&draft, &current).unwrap()["options"][0]["api_key"],
        ""
    );
}
