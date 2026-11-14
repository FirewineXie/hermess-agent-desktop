use crate::paths::filesystem_path;
use std::{fs, io::Write, path::Path};

const SKILLS: [(&str, &[u8]); 2] = [
    (
        "hermess-desktop-guide",
        include_bytes!("../../../agent-skills/hermess-desktop-guide/SKILL.md"),
    ),
    (
        "hermess-plugin-development",
        include_bytes!("../../../agent-skills/hermess-plugin-development/SKILL.md"),
    ),
];

fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(filesystem_path(path)).is_ok_and(|metadata| {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 0x400 != 0
        }
        #[cfg(not(windows))]
        metadata.file_type().is_symlink()
    })
}

fn write_skill(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().expect("skill files have a parent directory");
    let mut staged = tempfile::NamedTempFile::new_in(filesystem_path(parent))?;
    staged.write_all(content)?;
    staged.persist(filesystem_path(path))?;
    Ok(())
}

fn install_to_home(
    home: &Path,
    name: &str,
    content: &[u8],
    previous: Option<&[u8]>,
) -> Result<(), String> {
    let skills_root = home.join("skills");
    let directory = skills_root.join(name);
    let file = directory.join("SKILL.md");
    if [home, &skills_root, &directory, &file]
        .into_iter()
        .any(is_link)
    {
        return Ok(());
    }
    fs::create_dir_all(filesystem_path(&directory))
        .map_err(|e| format!("无法创建 Skill {name} 目录：{e}"))?;
    match fs::read(filesystem_path(&file)) {
        Ok(existing) if existing == content => return Ok(()),
        Ok(existing) if previous != Some(existing.as_slice()) => return Ok(()),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("无法读取 Skill {name}：{error}")),
    }
    write_skill(&file, content).map_err(|e| format!("无法部署 Skill {name}：{e}"))
}

pub(super) fn install(storage: &Path) -> Result<(), String> {
    let home = storage.join("hermes-home");
    let control = storage.join("control");
    if is_link(&control) {
        return Err("产品控制目录不能是链接".into());
    }
    fs::create_dir_all(filesystem_path(&control))
        .map_err(|e| format!("无法创建产品控制目录：{e}"))?;
    for (name, content) in SKILLS {
        let marker = control.join(format!("{name}.SKILL.md"));
        let previous = fs::read(filesystem_path(&marker)).ok();
        install_existing_profiles(&home, name, content, previous.as_deref())?;
        if previous.as_deref() != Some(content) {
            write_skill(&marker, content)
                .map_err(|e| format!("无法记录 Skill {name} 版本：{e}"))?;
        }
    }
    Ok(())
}

fn install_existing_profiles(
    home: &Path,
    name: &str,
    content: &[u8],
    previous: Option<&[u8]>,
) -> Result<(), String> {
    install_to_home(home, name, content, previous)?;
    let profiles = home.join("profiles");
    if !is_link(home) && !is_link(&profiles) && filesystem_path(&profiles).is_dir() {
        for entry in fs::read_dir(filesystem_path(&profiles))
            .map_err(|e| format!("无法读取 Profile 目录：{e}"))?
        {
            let entry = entry.map_err(|e| format!("无法读取 Profile：{e}"))?;
            if entry
                .file_type()
                .map_err(|e| format!("无法检查 Profile：{e}"))?
                .is_dir()
            {
                install_to_home(&profiles.join(entry.file_name()), name, content, previous)?;
            }
        }
    }
    Ok(())
}

pub(super) fn install_new_profile(home: &Path, name: &str) -> Result<(), String> {
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Profile 名称无效，无法部署产品 Skill".into());
    }
    let profiles = home.join("profiles");
    if is_link(home) || is_link(&profiles) {
        return Ok(());
    }
    let profile = profiles.join(name);
    for (name, content) in SKILLS {
        install_to_home(&profile, name, content, None)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/product_skill.rs"]
mod tests;
