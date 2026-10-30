use super::profile_scope::valid_profile_name;
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
    install_to_home(
        &home,
        &storage.join("control").join("powershell-tool-initialized"),
    )?;
    let profiles = home.join("profiles");
    if profiles.is_dir() {
        for entry in fs::read_dir(&profiles).map_err(|e| format!("无法读取 Profile 目录：{e}"))?
        {
            let entry = entry.map_err(|e| format!("无法读取 Profile：{e}"))?;
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if valid_profile_name(&name)
                && name
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && entry
                    .file_type()
                    .map_err(|e| format!("无法检查 Profile：{e}"))?
                    .is_dir()
                && [
                    "config.yaml",
                    ".env",
                    "SOUL.md",
                    "profile.yaml",
                    "auth.json",
                    "state.db",
                ]
                .iter()
                .any(|file| path.join(file).is_file() || path.join(file).is_symlink())
                && !profiles.join(".deleted").join(name.as_ref()).exists()
            {
                install_to_home(&path, &path.join(".hermess-powershell-tool-initialized"))
                    .map_err(|error| {
                        format!("Profile {name} 的 PowerShell 工具部署失败：{error}")
                    })?;
            }
        }
    }
    Ok(())
}

pub(super) fn install_new_profile(home: &Path, name: &str) -> Result<(), String> {
    if !valid_profile_name(name) {
        return Err("Profile 名称无效，无法部署 PowerShell 工具".into());
    }
    let profile = home.join("profiles").join(name);
    if !profile.is_dir() {
        return Err("Profile 目录不存在，无法部署 PowerShell 工具".into());
    }
    install_to_home(
        &profile,
        &profile.join(".hermess-powershell-tool-initialized"),
    )
}

fn install_to_home(home: &Path, marker: &Path) -> Result<(), String> {
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
#[path = "tests/powershell_tool.rs"]
mod tests;
