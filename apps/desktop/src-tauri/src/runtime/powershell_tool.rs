use serde_yaml::{Mapping, Value};
use std::{fs, path::Path};

const TOOL_ID: &str = "hermess-windows-powershell";
const FILES: [(&str, &[u8]); 3] = [
    (
        "plugin.yaml",
        include_bytes!("../../../agent-tools/powershell/plugin.yaml"),
    ),
    (
        "__init__.py",
        include_bytes!("../../../agent-tools/powershell/__init__.py"),
    ),
    (
        "tool.py",
        include_bytes!("../../../agent-tools/powershell/tool.py"),
    ),
];

pub(super) fn install(storage: &Path) -> Result<(), String> {
    let home = storage.join("hermes-home");
    let directory = home.join("plugins").join(TOOL_ID);
    fs::create_dir_all(&directory).map_err(|e| format!("无法创建 PowerShell 工具目录：{e}"))?;
    for (name, expected) in FILES {
        let path = directory.join(name);
        if fs::read(&path).ok().as_deref() != Some(expected) {
            fs::write(&path, expected).map_err(|e| format!("无法部署 PowerShell 工具：{e}"))?;
        }
    }

    // Only the first product installation enables the tool. A later user opt-out
    // remains in effect across restarts and product upgrades.
    let marker = storage.join("control").join("powershell-tool-initialized");
    if marker.exists() {
        return Ok(());
    }
    let config_path = home.join("config.yaml");
    let mut config: Value = if config_path.exists() {
        serde_yaml::from_slice(
            &fs::read(&config_path).map_err(|e| format!("无法读取 Hermes 配置：{e}"))?,
        )
        .map_err(|e| format!("Hermes 配置格式无效：{e}"))?
    } else {
        Value::Mapping(Mapping::new())
    };
    let root = config.as_mapping_mut().ok_or("Hermes 配置顶层必须是映射")?;
    let plugins = root
        .entry(Value::String("plugins".into()))
        .or_insert_with(|| Value::Mapping(Mapping::new()))
        .as_mapping_mut()
        .ok_or("Hermes plugins 配置必须是映射")?;
    let enabled = plugins
        .entry(Value::String("enabled".into()))
        .or_insert_with(|| Value::Sequence(Vec::new()))
        .as_sequence_mut()
        .ok_or("Hermes plugins.enabled 必须是列表")?;
    if !enabled.iter().any(|value| value.as_str() == Some(TOOL_ID)) {
        enabled.push(Value::String(TOOL_ID.into()));
        let yaml =
            serde_yaml::to_string(&config).map_err(|e| format!("无法编码 Hermes 配置：{e}"))?;
        fs::create_dir_all(&home).map_err(|e| format!("无法创建 Hermes 配置目录：{e}"))?;
        fs::write(&config_path, yaml).map_err(|e| format!("无法启用 PowerShell 工具：{e}"))?;
    }
    fs::write(marker, b"1\n").map_err(|e| format!("无法记录 PowerShell 工具状态：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
