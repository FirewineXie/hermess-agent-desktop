use super::DesktopFailure;
use crate::gateway::GatewayRequestError;

#[test]
fn superseded_rpc_preserves_the_named_refusal_without_exposing_gateway_details() {
    let error = DesktopFailure::from(GatewayRequestError::Rpc {
        message: "session_superseded".into(),
        code: -32000,
    });
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        serde_json::json!({
            "kind": "desktop_failure", "code": "session_superseded", "category": "validation"
        })
    );
    for error in [
        GatewayRequestError::Transport("session_superseded".into()),
        GatewayRequestError::Rpc {
            message: "other internal details".into(),
            code: -32000,
        },
    ] {
        assert_eq!(
            serde_json::to_value(DesktopFailure::from(error)).unwrap()["code"],
            "operation_failed"
        );
    }
}

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
    assert_eq!(
        serde_json::to_value(DesktopFailure::from("session_owner_unknown".to_owned())).unwrap()
            ["code"],
        "session_owner_unknown"
    );
    assert_eq!(
        serde_json::to_value(DesktopFailure::from("session_profile_mismatch".to_owned())).unwrap()
            ["code"],
        "session_profile_mismatch"
    );
}
