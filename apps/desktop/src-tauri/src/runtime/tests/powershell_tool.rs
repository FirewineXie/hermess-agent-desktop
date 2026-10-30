use super::{install, install_new_profile, FILES, TOOL_ID};
use serde_yaml::Value;
use std::fs;
use uuid::Uuid;

#[test]
fn installs_tool_once_and_preserves_user_disable() {
    let storage = std::env::temp_dir().join(format!("hermess-powershell-{}", Uuid::new_v4()));
    fs::create_dir_all(storage.join("control")).unwrap();
    install(&storage).unwrap();
    let home = storage.join("hermes-home");
    let tool = home.join("plugins").join(TOOL_ID);
    for (name, expected) in FILES {
        assert_eq!(fs::read(tool.join(name)).unwrap(), expected);
    }
    let config_path = home.join("config.yaml");
    let initial: Value = serde_yaml::from_slice(&fs::read(&config_path).unwrap()).unwrap();
    assert_eq!(initial["plugins"]["enabled"][0].as_str(), Some(TOOL_ID));

    fs::write(&config_path, "plugins:\n  enabled: []\n").unwrap();
    install(&storage).unwrap();
    let after: Value = serde_yaml::from_slice(&fs::read(&config_path).unwrap()).unwrap();
    assert_eq!(after["plugins"]["enabled"].as_sequence().unwrap().len(), 0);
    fs::remove_dir_all(storage).unwrap();
}

#[test]
fn installs_existing_and_new_named_profiles_without_reenabling_opted_out_profiles() {
    let storage =
        std::env::temp_dir().join(format!("hermess-powershell-profiles-{}", Uuid::new_v4()));
    let home = storage.join("hermes-home");
    let profiles = home.join("profiles");
    let existing = profiles.join("existing");
    let ghost = profiles.join("ghost");
    fs::create_dir_all(storage.join("control")).unwrap();
    fs::create_dir_all(&existing).unwrap();
    fs::create_dir_all(&ghost).unwrap();
    fs::write(existing.join("config.yaml"), "agent: {}\n").unwrap();
    install(&storage).unwrap();
    let enabled: Value =
        serde_yaml::from_slice(&fs::read(existing.join("config.yaml")).unwrap()).unwrap();
    assert_eq!(enabled["plugins"]["enabled"][0].as_str(), Some(TOOL_ID));
    assert!(existing
        .join("plugins")
        .join(TOOL_ID)
        .join("tool.py")
        .is_file());
    assert!(!ghost.join("plugins").exists());

    fs::write(existing.join("config.yaml"), "plugins:\n  enabled: []\n").unwrap();
    install(&storage).unwrap();
    let disabled: Value =
        serde_yaml::from_slice(&fs::read(existing.join("config.yaml")).unwrap()).unwrap();
    assert!(disabled["plugins"]["enabled"]
        .as_sequence()
        .unwrap()
        .is_empty());

    let created = profiles.join("created");
    fs::create_dir_all(&created).unwrap();
    fs::write(created.join("config.yaml"), "agent: {}\n").unwrap();
    install_new_profile(&home, "created").unwrap();
    let new_config: Value =
        serde_yaml::from_slice(&fs::read(created.join("config.yaml")).unwrap()).unwrap();
    assert_eq!(new_config["plugins"]["enabled"][0].as_str(), Some(TOOL_ID));
    fs::remove_dir_all(storage).unwrap();
}
