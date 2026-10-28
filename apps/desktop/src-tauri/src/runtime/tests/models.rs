use super::valid_moa_config;
use serde_json::json;

fn config() -> serde_json::Value {
    let preset = json!({
        "enabled": true,
        "aggregator": {"provider": "openai", "model": "gpt-5", "enabled": true},
        "aggregator_temperature": 0.2,
        "degraded_reference_policy": "loud",
        "reference_models": [{"provider": "anthropic", "model": "claude", "reasoning_effort": "high"}],
        "reference_temperature": 0.4,
        "reference_timeout": 120,
        "fanout": "user_turn"
    });
    json!({
        "default_preset": "default",
        "active_preset": "default",
        "presets": {"default": preset.clone()},
        "enabled": true,
        "aggregator": preset["aggregator"].clone(),
        "aggregator_temperature": 0.2,
        "degraded_reference_policy": "loud",
        "reference_models": preset["reference_models"].clone(),
        "reference_temperature": 0.4,
        "reference_timeout": 120
    })
}

#[test]
fn accepts_a_bounded_moa_config() {
    assert!(valid_moa_config(&config()));
}

#[test]
fn accepts_inactive_moa_and_rejects_unknown_active_preset() {
    let mut inactive = config();
    inactive["active_preset"] = json!("");
    assert!(valid_moa_config(&inactive));

    inactive["active_preset"] = json!("unknown");
    assert!(!valid_moa_config(&inactive));
}

#[test]
fn rejects_invalid_slots() {
    let mut invalid = config();
    invalid["presets"]["default"]["reference_models"][0]["model"] = json!("");
    assert!(!valid_moa_config(&invalid));
}
