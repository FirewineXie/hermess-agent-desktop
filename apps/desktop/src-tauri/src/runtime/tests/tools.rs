use super::{stt_toggle_body, toggle_args, STT_TOGGLE_ROUTE};
use serde_json::json;

#[test]
#[ignore]
fn print_production_toolset_toggle_args() {
    for profile in ["default", "worker_beta"] {
        for enabled in [false, true] {
            println!(
                "TOOLSET_TOGGLE={}",
                json!({"profile": profile, "enabled": enabled,
                "args": toggle_args(profile, "cli", "web", enabled)})
            );
        }
    }
    for enabled in [false, true] {
        println!(
            "TOOLSET_STT_TOGGLE={}",
            json!({"method": "PUT", "path": STT_TOGGLE_ROUTE, "body": stt_toggle_body(enabled)})
        );
    }
}
