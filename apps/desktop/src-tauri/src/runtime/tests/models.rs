use super::{chat_model_mutation, chat_model_payload, moa_path, valid_moa_config};
use serde_json::json;

#[cfg(windows)]
#[test]
fn failed_catalogue_replace_preserves_the_existing_file() {
    use std::{collections::HashMap, fs, os::windows::fs::OpenOptionsExt};
    let root = std::env::temp_dir().join(format!("hermess-catalogue-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let file = root.join("models.json");
    let old = HashMap::from([("provider".to_string(), vec!["old".to_string()])]);
    super::write_model_lists_file(&file, &old).unwrap();
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&file)
        .unwrap();
    let replacement = HashMap::from([("provider".to_string(), vec!["new".to_string()])]);
    assert!(super::write_model_lists_file(&file, &replacement).is_err());
    assert_eq!(super::read_model_lists_file(&file).unwrap(), Some(old));
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    drop(held);
    super::write_model_lists_file(&file, &replacement).unwrap();
    assert_eq!(
        super::read_model_lists_file(&file).unwrap(),
        Some(replacement)
    );
    fs::remove_dir_all(&root).unwrap();
}

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
fn moa_route_scopes_and_encodes_the_selected_profile() {
    assert_eq!(
        moa_path("research & review").unwrap(),
        "/api/model/moa?profile=research+%26+review"
    );
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
#[test]
#[ignore = "run by the isolated locked Gateway receiver probe"]
fn print_production_gateway_feature_model() {
    for (id, provider, model) in [
        ("model-override", Some("custom"), "desktop-model-override"),
        ("model-reset", None, "reset"),
        ("model-reset-invalid", Some("custom"), "reset"),
    ] {
        let payload = chat_model_payload(provider, model, None).unwrap();
        let params = chat_model_mutation(
            "fixture",
            id,
            &serde_json::json!({
                "revision": 0, "execution_generation": 0,
            }),
            payload,
        )
        .unwrap();
        println!(
            "FEATURE_SHAPE={}",
            serde_json::json!({"id": id, "method": "session.mutate", "params": params})
        );
    }
}
