use super::request_shape;
use serde_json::json;

#[test]
fn pairing_rejects_incomplete_or_unknown_operations() {
    assert!(request_shape(
        "default",
        "pairing.approve",
        &json!({"platform":"telegram"})
    )
    .is_err());
    assert!(request_shape("default", "pairing.revoke", &json!({"platform":"telegram"})).is_err());
    assert!(request_shape("default", "pairing.unknown", &json!({})).is_err());
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_pairing_request_shapes() {
    for (operation, payload) in [
        ("pairing.list", json!({})),
        (
            "pairing.approve",
            json!({"platform":"telegram","request_id":"REQUEST_ID"}),
        ),
        (
            "pairing.revoke",
            json!({"platform":"telegram","user_id":"12345"}),
        ),
        ("pairing.clearPending", json!({})),
    ] {
        let (method, path, body) = request_shape("default", operation, &payload).unwrap();
        println!(
            "PAIRING_SHAPE={}",
            json!({"operation":operation,"method":method.as_str(),"path":path,"body":body})
        );
    }
}
