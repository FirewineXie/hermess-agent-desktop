use super::{catalogue, current_target};
use std::fs;
use uuid::Uuid;

#[test]
fn catalogue_uses_pinned_target_and_product_owned_tool_facts() {
    let root = std::env::temp_dir().join(format!("hermess-tool-catalogue-{}", Uuid::new_v4()));
    let payload = root.join("payload");
    let home = root.join("product-home");
    fs::create_dir_all(payload.join("bin")).unwrap();
    fs::create_dir_all(payload.join("hermes-agent/pm")).unwrap();
    fs::create_dir_all(home.join("tools/ffmpeg-entry")).unwrap();
    fs::write(payload.join("manifest.json"), "{}").unwrap();
    fs::write(payload.join("bin/hermes.exe"), "").unwrap();
    fs::write(
        payload.join("hermes-agent/pm/lock.json"),
        serde_json::json!({"packages": {
            "ffmpeg": {"version": "9.0.1", "artifacts": {current_target(): {"sha256": "a"}}},
            "gh": {"version": "2.0", "artifacts": {"other-target": {"sha256": "b"}}}
        }})
        .to_string(),
    )
    .unwrap();
    fs::write(
        home.join("tools/facts.json"),
        serde_json::json!({"packages": {"ffmpeg": {
            "entry": "ffmpeg-entry", "version": "9.0.1", "target": current_target()
        }}})
        .to_string(),
    )
    .unwrap();
    let tools = catalogue(&payload.join("bin/hermes.exe"), &home).unwrap();
    assert!(tools
        .iter()
        .any(|tool| tool.name == "ffmpeg" && tool.installed && tool.supported));
    assert!(tools
        .iter()
        .any(|tool| tool.name == "gh" && !tool.installed && !tool.supported));
    fs::remove_dir_all(root).unwrap();
}
