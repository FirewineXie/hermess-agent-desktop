use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};
use tauri::State;
use uuid::Uuid;

const MAX_FILE_BYTES: usize = 256 * 1024;
const ENTRY_DELIMITER: &str = "\n§\n";

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PersonalFileKind {
    Soul,
    Memory,
    User,
}

impl PersonalFileKind {
    fn relative_path(self) -> &'static str {
        match self {
            Self::Soul => "SOUL.md",
            Self::Memory => "memories/MEMORY.md",
            Self::User => "memories/USER.md",
        }
    }

    fn config_keys(self) -> Option<(&'static str, &'static str, usize)> {
        match self {
            Self::Soul => None,
            Self::Memory => Some(("memory_enabled", "memory_char_limit", 2200)),
            Self::User => Some(("user_profile_enabled", "user_char_limit", 1375)),
        }
    }
}

#[derive(Serialize)]
pub struct PersonalFile {
    kind: PersonalFileKind,
    path: String,
    exists: bool,
    content: String,
    entries: Vec<String>,
    version: String,
    limit: Option<usize>,
    enabled: Option<bool>,
}

fn file_version(raw: Option<&[u8]>) -> String {
    match raw {
        None => "missing".to_owned(),
        Some(bytes) => format!("sha256:{:x}", Sha256::digest(bytes)),
    }
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, DesktopFailure> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(DesktopFailure::operation_failed()),
    };
    if !metadata.file_type().is_file() || metadata.len() > MAX_FILE_BYTES as u64 {
        return Err(DesktopFailure::invalid_input());
    }
    let raw = fs::read(path).map_err(|_| DesktopFailure::operation_failed())?;
    if raw.len() > MAX_FILE_BYTES {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(Some(raw))
}

fn decode(raw: Option<&[u8]>) -> Result<String, DesktopFailure> {
    let bytes = raw.unwrap_or_default();
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    String::from_utf8(bytes.to_vec()).map_err(|_| DesktopFailure::operation_failed())
}

fn parse_entries(raw: &str) -> Vec<String> {
    raw.split(ENTRY_DELIMITER)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_owned)
        .collect()
}

fn memory_text(entries: &[String], limit: usize) -> Result<String, DesktopFailure> {
    let mut seen = HashSet::new();
    if entries.iter().any(|entry| {
        entry.trim().is_empty()
            || entry != entry.trim()
            || entry.contains(ENTRY_DELIMITER)
            || !seen.insert(entry)
    }) {
        return Err(DesktopFailure::invalid_input());
    }
    let text = entries.join(ENTRY_DELIMITER);
    if text.chars().count() > limit || text.len() > MAX_FILE_BYTES {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(text)
}

fn memory_config(config: &Value, kind: PersonalFileKind) -> (Option<bool>, Option<usize>) {
    let Some((enabled_key, limit_key, default_limit)) = kind.config_keys() else {
        return (None, None);
    };
    let section = config.get("memory");
    let enabled = section
        .and_then(|value| value.get(enabled_key))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let limit = section
        .and_then(|value| value.get(limit_key))
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
        .unwrap_or(default_limit);
    (Some(enabled), Some(limit))
}

fn lock_file(lock_path: &Path) -> Result<File, DesktopFailure> {
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent).map_err(|_| DesktopFailure::operation_failed())?;
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(lock_path)
        .map_err(|_| DesktopFailure::operation_failed())?;
    file.lock()
        .map_err(|_| DesktopFailure::operation_failed())?;
    Ok(file)
}

fn write_checked(
    path: &Path,
    lock_path: &Path,
    expected_version: &str,
    content: &str,
) -> Result<(), DesktopFailure> {
    if content.len() > MAX_FILE_BYTES || expected_version.len() > 80 {
        return Err(DesktopFailure::invalid_input());
    }
    let parent = path.parent().ok_or_else(DesktopFailure::invalid_input)?;
    fs::create_dir_all(parent).map_err(|_| DesktopFailure::operation_failed())?;
    let _lock = lock_file(lock_path)?;
    let current = read_bytes(path)?;
    if file_version(current.as_deref()) != expected_version {
        return Err(DesktopFailure::conflict());
    }
    let temp = parent.join(format!(".hermess-edit-{}", Uuid::new_v4()));
    let result = (|| -> Result<(), std::io::Error> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
        return Err(DesktopFailure::operation_failed());
    }
    Ok(())
}

#[tauri::command]
pub async fn read_personal_file(
    state: State<'_, BackendState>,
    profile: String,
    kind: PersonalFileKind,
) -> Result<PersonalFile, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    read_personal_file_for_scope(&state, &scope, kind).await
}

async fn read_personal_file_for_scope(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    kind: PersonalFileKind,
) -> Result<PersonalFile, DesktopFailure> {
    let config = if kind.config_keys().is_some() {
        config_request_for_scope(state, scope, reqwest::Method::GET, "/api/config", None).await?
    } else {
        Value::Null
    };
    scope.ensure_current(state).await?;
    let path = scope.home.join(kind.relative_path());
    let raw = read_bytes(&path)?;
    let content = decode(raw.as_deref())?;
    let entries = if kind.config_keys().is_some() {
        parse_entries(&content)
    } else {
        vec![]
    };
    let (enabled, limit) = memory_config(&config, kind);
    scope.ensure_current(state).await?;
    Ok(PersonalFile {
        kind,
        path: path.to_string_lossy().into_owned(),
        exists: raw.is_some(),
        content: if kind.config_keys().is_none() {
            content
        } else {
            String::new()
        },
        entries,
        version: file_version(raw.as_deref()),
        limit,
        enabled,
    })
}

#[tauri::command]
pub async fn save_personal_file(
    state: State<'_, BackendState>,
    profile: String,
    kind: PersonalFileKind,
    content: Option<String>,
    entries: Option<Vec<String>>,
    expected_version: String,
) -> Result<PersonalFile, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let value = if kind.config_keys().is_some() {
        let entries = entries.ok_or_else(DesktopFailure::invalid_input)?;
        let config =
            config_request_for_scope(&state, &scope, reqwest::Method::GET, "/api/config", None)
                .await?;
        let (_, limit) = memory_config(&config, kind);
        memory_text(&entries, limit.unwrap_or(0))?
    } else {
        content.ok_or_else(DesktopFailure::invalid_input)?
    };
    scope.ensure_current(&state).await?;
    let path = scope.home.join(kind.relative_path());
    write_checked(
        &path,
        &path.with_extension("md.lock"),
        &expected_version,
        &value,
    )?;
    scope.ensure_current(&state).await?;
    read_personal_file_for_scope(&state, &scope, kind).await
}

#[cfg(test)]
#[path = "tests/personal_files.rs"]
mod tests;
