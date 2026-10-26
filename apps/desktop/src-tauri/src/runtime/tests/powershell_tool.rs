use super::{install, FILES, TOOL_ID};
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
