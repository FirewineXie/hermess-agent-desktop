use super::*;

#[test]
fn secret_and_oauth_detail_never_reach_the_ui() {
    let config = project_config(json!({"name":"example","label":"Example","fields":[{"key":"token","kind":"secret","value":"private","is_set":true}]})).unwrap();
    assert_eq!(config["fields"][0]["value"], "");
    assert!(!config.to_string().contains("private"));
    let oauth =
        project_oauth(json!({"state":"error","connected":false,"detail":"private"})).unwrap();
    assert!(!oauth.to_string().contains("private"));
    assert!(provider_path("../other", "config").is_err());
    assert_eq!(
        provider_path("my-provider", "config").unwrap(),
        "/api/memory/providers/my-provider/config"
    );
}

#[test]
fn retaindb_native_fields_are_editable_without_exposing_secret() {
    let config = project_config(json!({"name":"retaindb","label":"RetainDB","fields":[
        {"key":"api_key","label":"API key","kind":"secret","value":"private","is_set":true},
        {"key":"base_url","label":"API endpoint","kind":"text","value":"https://api.retaindb.com"},
        {"key":"project","label":"Project","kind":"text","value":""},
        {"key":"enabled","label":"Enabled","kind":"boolean","value":false}
    ]}))
    .unwrap();
    assert_eq!(config["fields"].as_array().unwrap().len(), 4);
    assert_eq!(config["fields"][0]["value"], "");
    assert_eq!(config["fields"][1]["value"], "https://api.retaindb.com");
    assert_eq!(config["fields"][3]["kind"], "bool");
    assert_eq!(config["fields"][3]["value"], "false");
    assert!(!config.to_string().contains("private"));
}
