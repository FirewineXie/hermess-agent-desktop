use super::{key, request_shape};
use serde_json::json;

#[test]
fn env_key_validation_matches_receiver_name_shape() {
    assert_eq!(key(&json!({"key":"custom_key2"})).unwrap(), "custom_key2");
    for name in ["", "9KEY", "BAD-KEY", "../KEY", "KEY\nOTHER"] {
        assert!(key(&json!({"key":name})).is_err());
    }
    assert!(request_shape(
        "default",
        "envKeys.save",
        &json!({"key":"TEST_KEY","value":""})
    )
    .is_err());
    assert!(request_shape("default", "envKeys.unknown", &json!({})).is_err());
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_env_key_request_shapes() {
    for (operation, payload) in [
        ("envKeys.list", json!({})),
        (
            "envKeys.save",
            json!({"key":"HERMESS_DESKTOP_TEST_KEY","value":"temporary-test-value-12345"}),
        ),
        ("envKeys.reveal", json!({"key":"HERMESS_DESKTOP_TEST_KEY"})),
        ("envKeys.delete", json!({"key":"HERMESS_DESKTOP_TEST_KEY"})),
    ] {
        let (method, path, body) = request_shape("default", operation, &payload).unwrap();
        println!(
            "ENV_KEY_SHAPE={}",
            json!({"operation":operation,"method":method.as_str(),"path":path,"body":body})
        );
    }
}
