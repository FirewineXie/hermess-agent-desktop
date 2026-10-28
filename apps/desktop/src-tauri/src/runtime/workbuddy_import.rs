use super::{profiles, BackendState};
use crate::errors::DesktopFailure;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::State;

const MAX_FILES: usize = 1000;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    name: String,
    version: String,
    expert_type: String,
    agent_name: String,
    agents: Vec<String>,
    skills: Vec<String>,
    team_info: TeamInfo,
    display_name: Value,
    display_description: Option<Value>,
    members: Vec<Member>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamInfo {
    lead_agent: String,
    member_agents: Vec<String>,
}

#[derive(Deserialize)]
struct Member {
    id: String,
    name: Value,
    profession: Option<Value>,
    role: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    package_name: String,
    version: String,
    display_name: String,
    profile_name: String,
    lead: String,
    members: Vec<String>,
    skills: Vec<String>,
    mcp_count: usize,
    script_count: usize,
    file_count: usize,
    total_bytes: u64,
    digest: String,
    soul: String,
    notices: Vec<String>,
}

struct Inspected {
    files: Vec<(PathBuf, Vec<u8>)>,
    preview: ImportPreview,
}

fn valid_name(name: &str) -> bool {
    name.len() <= 64
        && name != "default"
        && name
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn translated(value: &Value) -> Option<&str> {
    value
        .as_str()
        .or_else(|| value.get("zh").and_then(Value::as_str))
        .or_else(|| value.get("en").and_then(Value::as_str))
}

fn frontmatter(data: &str) -> Result<serde_yaml::Value, DesktopFailure> {
    if !data.starts_with("---\n") && !data.starts_with("---\r\n") {
        return Err(DesktopFailure::invalid_input());
    }
    let header = data
        .splitn(3, "---")
        .nth(1)
        .ok_or_else(DesktopFailure::invalid_input)?;
    serde_yaml::from_str(header).map_err(|_| DesktopFailure::invalid_input())
}

fn package_path(root: &Path, raw: &str) -> Result<PathBuf, DesktopFailure> {
    let relative = Path::new(raw.strip_prefix("./").unwrap_or(raw));
    if raw.is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let full = root.join(relative);
    if !full
        .canonicalize()
        .map_err(|_| DesktopFailure::invalid_input())?
        .starts_with(root)
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(full)
}

fn collect(
    root: &Path,
    dir: &Path,
    files: &mut Vec<(PathBuf, Vec<u8>)>,
    total: &mut u64,
) -> Result<(), DesktopFailure> {
    let mut entries = fs::read_dir(dir)
        .map_err(|_| DesktopFailure::invalid_input())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| DesktopFailure::invalid_input())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|_| DesktopFailure::invalid_input())?;
        #[cfg(windows)]
        let reparse_point = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let reparse_point = false;
        if metadata.file_type().is_symlink()
            || reparse_point
            || !path
                .canonicalize()
                .map_err(|_| DesktopFailure::invalid_input())?
                .starts_with(root)
        {
            return Err(DesktopFailure::invalid_input());
        }
        if metadata.is_dir() {
            collect(root, &path, files, total)?;
        } else if metadata.is_file() {
            if files.len() >= MAX_FILES
                || metadata.len() > MAX_FILE_BYTES
                || *total + metadata.len() > MAX_TOTAL_BYTES
            {
                return Err(DesktopFailure::invalid_input());
            }
            let bytes = fs::read(&path).map_err(|_| DesktopFailure::invalid_input())?;
            *total += bytes.len() as u64;
            files.push((
                path.strip_prefix(root)
                    .map_err(|_| DesktopFailure::invalid_input())?
                    .to_path_buf(),
                bytes,
            ));
        } else {
            return Err(DesktopFailure::invalid_input());
        }
    }
    Ok(())
}

fn inspect(path: &str) -> Result<Inspected, DesktopFailure> {
    let root = fs::canonicalize(path).map_err(|_| DesktopFailure::invalid_input())?;
    if !root.is_dir() {
        return Err(DesktopFailure::invalid_input());
    }
    let manifest_file = package_path(&root, ".codebuddy-plugin/plugin.json")?;
    if fs::metadata(&manifest_file)
        .map_err(|_| DesktopFailure::invalid_input())?
        .len()
        > 256 * 1024
    {
        return Err(DesktopFailure::invalid_input());
    }
    let manifest_bytes = fs::read(manifest_file).map_err(|_| DesktopFailure::invalid_input())?;
    let raw_manifest: Value =
        serde_json::from_slice(&manifest_bytes).map_err(|_| DesktopFailure::invalid_input())?;
    if raw_manifest.get("mcp").is_some() || raw_manifest.get("mcpServers").is_some() {
        return Err(DesktopFailure::invalid_input());
    }
    let manifest: Manifest =
        serde_json::from_value(raw_manifest).map_err(|_| DesktopFailure::invalid_input())?;
    if manifest.expert_type != "team"
        || !valid_name(&manifest.name)
        || manifest.agent_name != manifest.team_info.lead_agent
        || manifest.agents.is_empty()
        || manifest.agents.len() > 32
        || manifest.skills.len() > 64
        || manifest.members.len() != manifest.agents.len()
        || manifest.team_info.member_agents.len() + 1 != manifest.agents.len()
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut agents = Vec::new();
    let mut lead_meta = None;
    for raw in &manifest.agents {
        let file = package_path(&root, raw)?;
        if !file.is_file() || file.extension().and_then(|s| s.to_str()) != Some("md") {
            return Err(DesktopFailure::invalid_input());
        }
        let id = file
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(DesktopFailure::invalid_input)?;
        let data = fs::read_to_string(&file).map_err(|_| DesktopFailure::invalid_input())?;
        let metadata = frontmatter(&data)?;
        if metadata.get("name").and_then(serde_yaml::Value::as_str) != Some(id) {
            return Err(DesktopFailure::invalid_input());
        }
        if id == manifest.agent_name {
            lead_meta = Some(metadata);
        }
        agents.push(id.to_owned());
    }
    agents.sort();
    agents.dedup();
    let mut expected = manifest.team_info.member_agents.clone();
    expected.push(manifest.agent_name.clone());
    expected.sort();
    expected.dedup();
    let mut member_ids = manifest
        .members
        .iter()
        .map(|m| m.id.clone())
        .collect::<Vec<_>>();
    member_ids.sort();
    if agents != expected
        || member_ids != agents
        || manifest
            .members
            .iter()
            .filter(|m| m.role == "lead" && m.id == manifest.agent_name)
            .count()
            != 1
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut skills = Vec::new();
    for raw in &manifest.skills {
        let dir = package_path(&root, raw)?;
        let skill_file = package_path(&root, &format!("{raw}/SKILL.md"))?;
        if !dir.is_dir() || !skill_file.is_file() {
            return Err(DesktopFailure::invalid_input());
        }
        let data = fs::read_to_string(skill_file).map_err(|_| DesktopFailure::invalid_input())?;
        let id = dir
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(DesktopFailure::invalid_input)?;
        let metadata = frontmatter(&data)?;
        if metadata.get("name").and_then(serde_yaml::Value::as_str) != Some(id) {
            return Err(DesktopFailure::invalid_input());
        }
        skills.push(id.to_owned());
    }
    skills.sort();
    skills.dedup();
    if skills.len() != manifest.skills.len() {
        return Err(DesktopFailure::invalid_input());
    }
    let lead = manifest
        .members
        .iter()
        .find(|m| m.id == manifest.agent_name)
        .ok_or_else(DesktopFailure::invalid_input)?;
    let lead_meta = lead_meta.ok_or_else(DesktopFailure::invalid_input)?;
    let lead_meta_json =
        serde_json::to_value(lead_meta).map_err(|_| DesktopFailure::invalid_input())?;
    let lead_name = translated(&lead.name).unwrap_or(&lead.id).to_owned();
    let profession = lead_meta_json
        .get("profession")
        .and_then(translated)
        .or_else(|| lead.profession.as_ref().and_then(translated))
        .unwrap_or("主理人");
    let display_name = translated(&manifest.display_name)
        .unwrap_or(&manifest.name)
        .to_owned();
    let description = manifest
        .display_description
        .as_ref()
        .and_then(translated)
        .unwrap_or("");
    let responsibility = lead_meta_json
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    if display_name.len() > 256
        || lead_name.len() > 256
        || description.len() > 4096
        || responsibility.len() > 2048
    {
        return Err(DesktopFailure::invalid_input());
    }
    let members = manifest
        .members
        .iter()
        .filter(|m| m.id != manifest.agent_name)
        .map(|m| translated(&m.name).unwrap_or(&m.id).to_owned())
        .collect::<Vec<_>>();
    let soul = format!("# {lead_name} · {profession}\n\n你是「{display_name}」的主理人。{description}\n\n职责摘要：{responsibility}\n\n已导入的 Skill：{}。按当前实际可用的工具和配置完成任务；成员角色原文保存在导入包中，不能将其视为已注册的子 Agent。\n", skills.join("、"));
    let mut files = Vec::new();
    let mut total = 0;
    collect(&root, &root, &mut files, &mut total)?;
    let declared_skills = manifest
        .skills
        .iter()
        .map(|raw| Path::new(raw.strip_prefix("./").unwrap_or(raw)).join("SKILL.md"))
        .collect::<Vec<_>>();
    if files.iter().any(|(relative, _)| {
        relative.file_name().is_some_and(|name| name == "SKILL.md")
            && !declared_skills.contains(relative)
    }) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut hasher = Sha256::new();
    for (relative, bytes) in &files {
        hasher.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
        hasher.update([0]);
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    }
    let script_count = files
        .iter()
        .filter(|(path, _)| {
            path.extension()
                .and_then(|s| s.to_str())
                .is_some_and(|s| matches!(s, "py" | "sh" | "js" | "ps1"))
        })
        .count();
    let notices = if script_count > 0 {
        vec!["脚本和外部服务需要单独配置与运行验证".into()]
    } else {
        vec!["来源包声明的外部模型或工具需要单独验证".into()]
    };
    let preview = ImportPreview {
        package_name: manifest.name.clone(),
        version: manifest.version,
        display_name,
        profile_name: manifest.name,
        lead: lead_name,
        members,
        skills,
        mcp_count: 0,
        script_count,
        file_count: files.len(),
        total_bytes: total,
        digest: format!("{:x}", hasher.finalize()),
        soul,
        notices,
    };
    Ok(Inspected { files, preview })
}

fn copy_into_profile(item: &Inspected, destination: &Path) -> Result<(), DesktopFailure> {
    let imported = destination
        .join("skills/imports/workbuddy")
        .join(&item.preview.package_name);
    let record = destination
        .join("imports/workbuddy")
        .join(&item.preview.package_name);
    if imported.exists() || record.exists() {
        return Err(DesktopFailure::conflict());
    }
    let existing_skills = destination.join("skills");
    if existing_skills.is_dir() {
        for entry in
            fs::read_dir(existing_skills).map_err(|_| DesktopFailure::operation_failed())?
        {
            let entry = entry.map_err(|_| DesktopFailure::operation_failed())?;
            if item
                .preview
                .skills
                .iter()
                .any(|skill| entry.file_name() == skill.as_str())
            {
                return Err(DesktopFailure::conflict());
            }
        }
    }
    for (relative, bytes) in &item.files {
        for target in [imported.join(relative), record.join(relative)] {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|_| DesktopFailure::operation_failed())?;
            }
            fs::write(target, bytes).map_err(|_| DesktopFailure::operation_failed())?;
        }
    }
    fs::write(
        record.join("import.json"),
        serde_json::to_vec_pretty(&item.preview).map_err(|_| DesktopFailure::operation_failed())?,
    )
    .map_err(|_| DesktopFailure::operation_failed())?;
    Ok(())
}

#[tauri::command]
pub async fn inspect_workbuddy_import(path: String) -> Result<ImportPreview, DesktopFailure> {
    tokio::task::spawn_blocking(move || inspect(&path).map(|item| item.preview))
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
}

#[tauri::command]
pub async fn import_workbuddy_package(
    state: State<'_, BackendState>,
    path: String,
    profile_name: String,
    expected_digest: String,
) -> Result<Value, DesktopFailure> {
    if !valid_name(&profile_name)
        || expected_digest.len() != 64
        || !expected_digest.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let item = tokio::task::spawn_blocking(move || inspect(&path))
        .await
        .map_err(|_| DesktopFailure::operation_failed())??;
    if item.preview.digest != expected_digest {
        return Err(DesktopFailure::conflict());
    }
    let home = {
        let owned = state.0.lock().await;
        owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?
            .storage
            .join("hermes-home")
    };
    let destination = home.join("profiles").join(&profile_name);
    if destination.exists() {
        return Err(DesktopFailure::conflict());
    }
    let created =
        profiles::create_import_profile(state, profile_name.clone(), item.preview.soul.clone())
            .await?;
    let result = tokio::task::spawn_blocking(move || {
        if let Err(error) = copy_into_profile(&item, &destination) {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        Ok(created)
    })
    .await
    .map_err(|_| DesktopFailure::operation_failed())?;
    result
}

#[cfg(test)]
#[path = "tests/workbuddy_import.rs"]
mod tests;
