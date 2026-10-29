use std::{fs, path::Path};

const SKILL_NAME: &str = "hermess-desktop-guide";
const CONTENT: &[u8] = include_bytes!("../../../agent-skills/hermess-desktop-guide/SKILL.md");

fn install_to_home(home: &Path, previous: Option<&[u8]>) -> Result<(), String> {
    let skills_root = home.join("skills");
    if fs::symlink_metadata(&skills_root).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Ok(());
    }
    let directory = skills_root.join(SKILL_NAME);
    if fs::symlink_metadata(&directory).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Ok(());
    }
    fs::create_dir_all(&directory).map_err(|e| format!("无法创建 Hermess 使用向导目录：{e}"))?;
    let file = directory.join("SKILL.md");
    if fs::symlink_metadata(&file).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Ok(());
    }
    match fs::read(&file) {
        Ok(existing) if existing == CONTENT => return Ok(()),
        Ok(existing) if previous != Some(existing.as_slice()) => return Ok(()),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("无法读取 Hermess 使用向导：{error}")),
    }
    fs::write(file, CONTENT).map_err(|e| format!("无法部署 Hermess 使用向导：{e}"))
}

pub(super) fn install(storage: &Path) -> Result<(), String> {
    let home = storage.join("hermes-home");
    let marker = storage
        .join("control")
        .join("hermess-desktop-guide.SKILL.md");
    let previous = fs::read(&marker).ok();
    install_to_home(&home, previous.as_deref())?;
    let profiles = home.join("profiles");
    if profiles.is_dir() {
        for entry in fs::read_dir(&profiles).map_err(|e| format!("无法读取 Profile 目录：{e}"))?
        {
            let entry = entry.map_err(|e| format!("无法读取 Profile：{e}"))?;
            if entry
                .file_type()
                .map_err(|e| format!("无法检查 Profile：{e}"))?
                .is_dir()
            {
                install_to_home(&entry.path(), previous.as_deref())?;
            }
        }
    }
    fs::create_dir_all(storage.join("control"))
        .map_err(|e| format!("无法创建产品控制目录：{e}"))?;
    fs::write(marker, CONTENT).map_err(|e| format!("无法记录 Hermess 使用向导版本：{e}"))
}

pub(super) fn install_new_profile(home: &Path, name: &str) -> Result<(), String> {
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Profile 名称无效，无法部署使用向导".into());
    }
    install_to_home(&home.join("profiles").join(name), None)
}

#[cfg(test)]
#[path = "tests/product_skill.rs"]
mod tests;
