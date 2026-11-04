use super::{hook_body, hooks_path};
use serde_json::json;

#[test]
fn hook_input_is_bounded() {
    assert!(hook_body(
        &json!({"event":"on_tool_call","command":"C:\\tools\\hook.cmd","approve":false}),
        true
    )
    .is_ok());
    assert!(hook_body(
        &json!({"event":"on_tool_call","command":"echo\nsecret","approve":false}),
        true
    )
    .is_err());
    assert!(hook_body(
        &json!({"event":"on_tool_call","command":"hook","timeout":0,"approve":false}),
        true
    )
    .is_err());
    assert!(hook_body(&json!({"event":"on_tool_call","command":"hook"}), true).is_err());
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_hook_shapes() {
    let path = hooks_path(1420, "default").unwrap();
    println!("HOOK_SHAPE={}", json!({"method":"GET","path":path}));
    println!(
        "HOOK_SHAPE={}",
        json!({"method":"POST","path":path,"body":hook_body(
        &json!({"event":"on_session_start","command":"test-hook-command","matcher":"terminal","timeout":10,"approve":false}), true).unwrap()})
    );
    println!(
        "HOOK_SHAPE={}",
        json!({"method":"DELETE","path":path,"body":hook_body(
        &json!({"event":"on_session_start","command":"test-hook-command"}), false).unwrap()})
    );
}
