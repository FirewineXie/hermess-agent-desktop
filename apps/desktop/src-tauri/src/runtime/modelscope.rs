//! Client-owned ModelScope catalog adapter. No Hermes fork code is changed.

use crate::errors::DesktopFailure;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use uuid::Uuid;
use zip::ZipArchive;

const BASE: &str = "https://www.modelscope.cn";
const MAX_ARCHIVE: usize = 12 * 1024 * 1024;
const MAX_FILES: usize = 128;
const MAX_UNPACKED: usize = 32 * 1024 * 1024;
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Deserialize, Serialize)]
struct InstalledSkill {
    id: String,
    name: String,
    directory: String,
}

fn skill_id(identifier: &str) -> Result<&str, DesktopFailure> {
    let id = identifier
        .strip_prefix("modelscope:")
        .ok_or_else(DesktopFailure::invalid_input)?;
    let parts: Vec<_> = id.split('/').collect();
    if parts.len() != 2
        || parts.iter().enumerate().any(|(index, part)| {
            let clean = if index == 0 {
                part.strip_prefix('@').unwrap_or(part)
            } else {
                part
            };
            clean.is_empty()
                || clean.len() > 100
                || !clean
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(id)
}

fn client() -> Result<reqwest::Client, DesktopFailure> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| DesktopFailure::operation_failed())
}

async fn get_limited(url: Url, max: usize) -> Result<Vec<u8>, DesktopFailure> {
    let mut response = client()?
        .get(url)
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !response.status().is_success() || response.content_length().is_some_and(|n| n > max as u64)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        if body.len() + chunk.len() > max {
            return Err(DesktopFailure::operation_failed());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn model_url(path: &str) -> Result<Url, DesktopFailure> {
    Url::parse(BASE)
        .and_then(|base| base.join(path))
        .map_err(|_| DesktopFailure::operation_failed())
}

pub(super) async fn search(query: &str) -> Result<Value, DesktopFailure> {
    if query.len() > 500 || query.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let mut url = model_url("/openapi/v1/skills")?;
    if !query.trim().is_empty() {
        url.query_pairs_mut().append_pair("search", query.trim());
    }
    url.query_pairs_mut().append_pair("page_size", "20");
    let body = get_limited(url, 2 * 1024 * 1024).await?;
    let result: Value =
        serde_json::from_slice(&body).map_err(|_| DesktopFailure::operation_failed())?;
    if result.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::operation_failed());
    }
    let skills = result
        .pointer("/data/skills")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let results: Vec<Value> = skills
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?;
            let identifier = format!("modelscope:{id}");
            skill_id(&identifier).ok()?;
            Some(json!({
                "name": item.get("display_name").and_then(Value::as_str).unwrap_or(id),
                "description": item.get("description").and_then(Value::as_str).unwrap_or(""),
                "source": "modelscope",
                "identifier": identifier,
                "trust_level": "community",
            }))
        })
        .collect();
    Ok(json!({"results": results}))
}

async fn download(identifier: &str) -> Result<Vec<u8>, DesktopFailure> {
    let id = skill_id(identifier)?;
    let mut url = model_url("/skills/")?;
    url.path_segments_mut()
        .map_err(|_| DesktopFailure::operation_failed())?
        .extend(id.split('/'))
        .extend(["archive", "zip", "master"]);
    let bytes = get_limited(url, MAX_ARCHIVE).await?;
    if !bytes.starts_with(b"PK") {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(bytes)
}

fn archive_files(bytes: &[u8]) -> Result<BTreeMap<PathBuf, Vec<u8>>, DesktopFailure> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|_| DesktopFailure::operation_failed())?;
    if archive.len() == 0 || archive.len() > MAX_FILES + 1 {
        return Err(DesktopFailure::operation_failed());
    }
    let mut files = BTreeMap::new();
    let mut total = 0usize;
    let mut root: Option<String> = None;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| DesktopFailure::operation_failed())?;
        let raw = entry.name();
        if raw.contains('\\') || raw.contains(':') || raw.starts_with('/') {
            return Err(DesktopFailure::invalid_input());
        }
        let path = Path::new(raw);
        let components: Vec<_> = path.components().collect();
        if components
            .iter()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(DesktopFailure::invalid_input());
        }
        let first = components
            .first()
            .ok_or_else(DesktopFailure::invalid_input)?;
        let first = first.as_os_str().to_string_lossy().into_owned();
        if root.as_ref().is_some_and(|known| known != &first) {
            return Err(DesktopFailure::invalid_input());
        }
        root = Some(first);
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(DesktopFailure::invalid_input());
        }
        if entry.is_dir() {
            continue;
        }
        if components.len() < 2 || entry.size() > MAX_UNPACKED as u64 {
            return Err(DesktopFailure::invalid_input());
        }
        total = total
            .checked_add(entry.size() as usize)
            .ok_or_else(DesktopFailure::invalid_input)?;
        if total > MAX_UNPACKED || files.len() >= MAX_FILES {
            return Err(DesktopFailure::invalid_input());
        }
        let relative: PathBuf = components[1..].iter().collect();
        let mut content = Vec::new();
        let size = entry.size();
        entry
            .by_ref()
            .take(size)
            .read_to_end(&mut content)
            .map_err(|_| DesktopFailure::operation_failed())?;
        if content.len() as u64 != size {
            return Err(DesktopFailure::invalid_input());
        }
        if files.insert(relative, content).is_some() {
            return Err(DesktopFailure::invalid_input());
        }
    }
    if !files.contains_key(Path::new("SKILL.md")) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(files)
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn bundle_digest(files: &BTreeMap<PathBuf, Vec<u8>>) -> String {
    let mut hash = Sha256::new();
    for (path, content) in files {
        hash.update(path.to_string_lossy().as_bytes());
        hash.update([0]);
        hash.update(content);
    }
    format!("{:x}", hash.finalize())
}

fn declared_name(
    files: &BTreeMap<PathBuf, Vec<u8>>,
    fallback: &str,
) -> Result<String, DesktopFailure> {
    let text = std::str::from_utf8(&files[Path::new("SKILL.md")])
        .map_err(|_| DesktopFailure::invalid_input())?;
    if text.len() > 512 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    let name = if let Some(frontmatter) = text.strip_prefix("---\n") {
        let yaml = frontmatter
            .split_once("\n---")
            .ok_or_else(DesktopFailure::invalid_input)?
            .0;
        serde_yaml::from_str::<serde_yaml::Value>(yaml)
            .map_err(|_| DesktopFailure::invalid_input())?
            .get("name")
            .and_then(serde_yaml::Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| fallback.to_owned())
    } else {
        fallback.to_owned()
    };
    if name.is_empty()
        || name.len() > 64
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(name)
}

pub(super) async fn preview(identifier: &str) -> Result<Value, DesktopFailure> {
    let bytes = download(identifier).await?;
    let files = archive_files(&bytes)?;
    let skill_md = std::str::from_utf8(&files[Path::new("SKILL.md")])
        .map_err(|_| DesktopFailure::invalid_input())?;
    let id = skill_id(identifier)?;
    let name = declared_name(&files, id.rsplit('/').next().unwrap_or(id))?;
    Ok(json!({
        "name": name,
        "source": "modelscope",
        "identifier": identifier,
        "trust_level": "community",
        "skill_md": skill_md,
        "files": files.keys().map(|path| path.to_string_lossy().into_owned()).collect::<Vec<_>>(),
        "digest": bundle_digest(&files),
    }))
}

pub(super) async fn scan(identifier: &str) -> Result<Value, DesktopFailure> {
    let bytes = download(identifier).await?;
    let files = archive_files(&bytes)?;
    let id = skill_id(identifier)?;
    declared_name(&files, id.rsplit('/').next().unwrap_or(id))?;
    Ok(json!({
        "policy": "ask",
        "summary": "客户端已检查 ZIP 路径、文件数和体积；请阅读内容后确认安装。未执行 Hermes 的静态安全扫描。",
        "policy_reason": "这是来自 ModelScope 的第三方 Skill。",
        "digest": bundle_digest(&files),
    }))
}

fn owned_subdir(storage: &Path, name: &str) -> Result<PathBuf, DesktopFailure> {
    let root = storage
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let directory = storage
        .join(name)
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !directory.starts_with(&root) || directory == root {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(directory)
}

fn manifest_path(storage: &Path) -> Result<PathBuf, DesktopFailure> {
    Ok(owned_subdir(storage, "control")?.join("modelscope-skills.json"))
}

fn read_manifest(storage: &Path) -> Result<BTreeMap<String, InstalledSkill>, DesktopFailure> {
    let path = manifest_path(storage)?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_slice(&fs::read(path).map_err(|_| DesktopFailure::operation_failed())?)
        .map_err(|_| DesktopFailure::operation_failed())
}

fn write_manifest(
    storage: &Path,
    entries: &BTreeMap<String, InstalledSkill>,
) -> Result<(), DesktopFailure> {
    fs::write(
        manifest_path(storage)?,
        serde_json::to_vec_pretty(entries).map_err(|_| DesktopFailure::operation_failed())?,
    )
    .map_err(|_| DesktopFailure::operation_failed())
}

fn skills_root(storage: &Path) -> Result<PathBuf, DesktopFailure> {
    fs::create_dir_all(storage.join("hermes-home"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    let home = owned_subdir(storage, "hermes-home")?;
    let skills = home.join("skills");
    fs::create_dir_all(&skills).map_err(|_| DesktopFailure::operation_failed())?;
    let skills = skills
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !skills.starts_with(&home) || skills == home {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(skills)
}

fn local_name(id: &str) -> String {
    let slug = id
        .rsplit('/')
        .next()
        .unwrap_or("skill")
        .to_ascii_lowercase();
    let short = digest(id.as_bytes());
    format!("modelscope-{slug}-{}", &short[..8])
}

pub(super) fn installed(storage: &Path) -> Result<Value, DesktopFailure> {
    let entries = read_manifest(storage)?;
    let mut by_identifier = serde_json::Map::new();
    let mut by_name = serde_json::Map::new();
    for entry in entries.values() {
        if storage
            .join("hermes-home")
            .join("skills")
            .join(&entry.directory)
            .join("SKILL.md")
            .is_file()
        {
            by_identifier.insert(format!("modelscope:{}", entry.id), Value::Bool(true));
            by_name.insert(
                entry.name.clone(),
                Value::String(format!("modelscope:{}", entry.id)),
            );
        }
    }
    Ok(json!({"identifiers": by_identifier, "names": by_name}))
}

pub(super) async fn install(
    storage: &Path,
    identifier: &str,
    expected_digest: &str,
    confirmed: bool,
    existing_names: &[String],
) -> Result<Value, DesktopFailure> {
    let id = skill_id(identifier)?;
    if !confirmed
        || expected_digest.len() != 64
        || !expected_digest.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let bytes = download(identifier).await?;
    let files = archive_files(&bytes)?;
    if bundle_digest(&files) != expected_digest {
        return Err(DesktopFailure::conflict());
    }
    let name = declared_name(&files, id.rsplit('/').next().unwrap_or(id))?;
    if existing_names
        .iter()
        .any(|existing| existing == &name || existing.ends_with(&format!("/{name}")))
    {
        return Err(DesktopFailure::conflict());
    }
    let storage = storage.to_path_buf();
    let id = id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = INSTALL_LOCK
            .lock()
            .map_err(|_| DesktopFailure::operation_failed())?;
        let mut entries = read_manifest(&storage)?;
        if entries.contains_key(&id) {
            return Err(DesktopFailure::conflict());
        }
        let root = skills_root(&storage)?;
        let directory = local_name(&id);
        let destination = root.join(&directory);
        if destination.exists() {
            return Err(DesktopFailure::conflict());
        }
        let staging =
            owned_subdir(&storage, "control")?.join(format!("modelscope-stage-{}", Uuid::new_v4()));
        fs::create_dir(&staging).map_err(|_| DesktopFailure::operation_failed())?;
        let write_result = (|| {
            for (relative, content) in files {
                let path = staging.join(relative);
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|_| DesktopFailure::operation_failed())?;
                }
                fs::write(path, content).map_err(|_| DesktopFailure::operation_failed())?;
            }
            fs::rename(&staging, &destination).map_err(|_| DesktopFailure::operation_failed())?;
            entries.insert(
                id.clone(),
                InstalledSkill {
                    id: id.clone(),
                    name: name.clone(),
                    directory,
                },
            );
            if let Err(error) = write_manifest(&storage, &entries) {
                let _ = fs::remove_dir_all(&destination);
                return Err(error);
            }
            Ok(json!({"ok": true, "name": name}))
        })();
        if write_result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        write_result
    })
    .await
    .map_err(|_| DesktopFailure::operation_failed())?
}

pub(super) fn uninstall(storage: &Path, name: &str) -> Result<Value, DesktopFailure> {
    let _guard = INSTALL_LOCK
        .lock()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut entries = read_manifest(storage)?;
    let id = entries
        .iter()
        .find(|(_, entry)| entry.name == name)
        .map(|(id, _)| id.clone())
        .ok_or_else(DesktopFailure::invalid_input)?;
    let entry = entries
        .remove(&id)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if entry.directory != local_name(&id) {
        return Err(DesktopFailure::invalid_input());
    }
    let root = skills_root(storage)?;
    let target = root.join(&entry.directory);
    if target.exists() {
        if target.is_symlink() || !target.is_dir() {
            return Err(DesktopFailure::invalid_input());
        }
        fs::remove_dir_all(target).map_err(|_| DesktopFailure::operation_failed())?;
    }
    write_manifest(storage, &entries)?;
    Ok(json!({"ok": true, "name": name}))
}

#[cfg(test)]
#[path = "tests/modelscope.rs"]
mod tests;
