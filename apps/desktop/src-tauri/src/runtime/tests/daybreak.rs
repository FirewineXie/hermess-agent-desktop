use super::daybreak_params;
use crate::runtime::profiles::scoped_params;
use serde_json::json;

#[test]
#[ignore = "run by the isolated locked Gateway receiver probe"]
fn print_production_gateway_feature_daybreak() {
    for (id, profile, operation, payload) in [
        ("daybreak-default", "default", "daybreak.status", json!({})),
        ("daybreak-read", "reviewer", "daybreak.status", json!({})),
        (
            "daybreak-enable",
            "reviewer",
            "daybreak.set",
            json!({"enabled":true}),
        ),
        (
            "daybreak-disable",
            "reviewer",
            "daybreak.set",
            json!({"enabled":false}),
        ),
    ] {
        let (method, params) = daybreak_params(operation, &payload).unwrap();
        let params = scoped_params(profile, method, params).unwrap();
        println!(
            "FEATURE_SHAPE={}",
            json!({"id": id, "method": method, "params": params})
        );
    }
}
