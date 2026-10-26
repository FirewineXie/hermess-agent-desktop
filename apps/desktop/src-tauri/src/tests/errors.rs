use super::DesktopFailure;

#[test]
fn desktop_failure_serializes_contract_fields() {
    let expected = serde_json::json!({
        "kind": "desktop_failure", "code": "operation_failed", "category": "operation"
    });
    assert_eq!(
        serde_json::to_value(DesktopFailure::operation_failed()).unwrap(),
        expected
    );
    assert_eq!(
        serde_json::to_value(DesktopFailure::runtime_unavailable()).unwrap()["category"],
        "runtime"
    );
    assert_eq!(
        serde_json::to_value(DesktopFailure::connection_lost()).unwrap()["category"],
        "connection"
    );
}
