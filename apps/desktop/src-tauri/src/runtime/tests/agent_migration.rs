use super::migration_args;
use serde_json::json;
use std::path::Path;

#[test]
#[ignore = "run by the isolated Hermes import receiver probe"]
fn print_production_agent_migration_shapes() {
    for source in [
        "grok-bot",
        "openbot",
        "claude-code",
        "openclaw",
        "codex",
        "cursor",
    ] {
        for apply in [false, true] {
            let args =
                migration_args("reviewer", source, Path::new("fixture-source"), apply).unwrap();
            let args: Vec<_> = args.iter().map(|arg| arg.to_str().unwrap()).collect();
            println!(
                "MIGRATION_SHAPE={}",
                json!({"source":source, "apply":apply, "args":args})
            );
        }
    }
}
