use super::{console_ws_request, valid_console_command};
use serde_json::json;

#[test]
fn console_request_binds_profile_and_keeps_native_ticket_out_of_url() {
    let loopback =
        console_ws_request(8765, "X-Hermes-Session-Token", "session secret", "writer").unwrap();
    let uri = loopback.uri().to_string();
    assert!(uri.starts_with("ws://127.0.0.1:8765/api/console?"));
    assert!(uri.contains("profile=writer"));
    assert!(uri.contains("token=session+secret") || uri.contains("token=session%20secret"));

    let native =
        console_ws_request(8765, "X-Hermes-Gateway-Ticket", "native-ticket", "writer").unwrap();
    assert_eq!(native.headers()["X-Hermes-Gateway-Ticket"], "native-ticket");
    assert!(!native.uri().to_string().contains("native-ticket"));
    assert!(native.uri().to_string().contains("profile=writer"));
}

#[test]
fn console_outgoing_boundary_matches_locked_client_frame_types() {
    for frame_type in ["input", "command", "confirm", "cancel", "ping"] {
        let data = json!({ "type": frame_type }).to_string();
        assert!(valid_console_command(&data));
    }
    assert!(!valid_console_command(r#"{"type":"unsupported"}"#));
    assert!(!valid_console_command("[]"));
}

#[test]
#[ignore = "prints the production websocket shape for the locked receiver integration test"]
fn print_production_console_request_shape() {
    let request =
        console_ws_request(1421, "X-Hermes-Session-Token", "PRODUCTION_TOKEN", "writer").unwrap();
    println!(
        "CONSOLE_SHAPE={}",
        serde_json::json!({ "uri": request.uri().to_string() })
    );
}
