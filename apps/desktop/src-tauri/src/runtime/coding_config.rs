use super::{coding_runtime, coding_vault};
use crate::{errors::DesktopFailure, paths::filesystem_path};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct CodingConfig {
    pub id: String,
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub effort: String,
    pub executable: String,
    pub has_key: bool,
    pub ignored_fields: Vec<String>,
}
#[derive(Deserialize)]
pub struct CodingConfigDraft {
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub effort: String,
    pub api_key: Option<String>,
}
#[derive(Deserialize, Serialize)]
pub(super) struct StoredConfig {
    pub id: String,
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
}
pub(super) fn root(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    owned(app, Path::new(""))
}
pub(super) fn owned(app: &AppHandle, relative: &Path) -> Result<PathBuf, DesktopFailure> {
    let mut path = super::location::programming_root(app)?;
    reject_link(&path)?;
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(DesktopFailure::invalid_input());
        };
        path.push(name);
        reject_link(&path)?;
    }
    Ok(path)
}
fn reject_link(path: &Path) -> Result<(), DesktopFailure> {
    match fs::symlink_metadata(filesystem_path(path)) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(DesktopFailure::invalid_input());
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(DesktopFailure::invalid_input());
                }
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(DesktopFailure::operation_failed()),
    }
}
pub(super) fn log(app: &AppHandle, event: &str) {
    let log_file = format!(
        "logs/client-{}.log",
        chrono::Local::now().format("%Y-%m-%d")
    );
    if let (Ok(root), Ok(_)) = (root(app), owned(app, Path::new(&log_file))) {
        let _ = crate::diagnostics::append_client_event(&root, event);
    }
}
pub(super) fn legacy(app: &AppHandle) -> Result<Option<StoredConfig>, DesktopFailure> {
    let root = root(app)?;
    let connection = owned(app, Path::new("connection.enc"))?;
    owned(app, Path::new("vault/master.key"))?;
    match fs::read(filesystem_path(&connection)) {
        Ok(bytes) => serde_json::from_slice(&coding_vault::decrypt(&root.join("vault"), &bytes)?)
            .map(Some)
            .map_err(|_| DesktopFailure::operation_failed()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(DesktopFailure::operation_failed()),
    }
}
pub(super) fn read(app: &AppHandle) -> Result<CodingConfig, DesktopFailure> {
    if super::coding_catalog::exists(app)? {
        let catalog = super::coding_catalog::load(app)?;
        if !catalog.default_model.is_empty() {
            return super::coding_catalog::route(app, None).map(|(config, _)| config);
        }
        return Ok(CodingConfig {
            enabled: catalog.enabled,
            effort: read_effort(app)?,
            executable: coding_runtime::executable(app)
                .ok()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_default(),
            ignored_fields: ignored_fields(app)?,
            ..Default::default()
        });
    }
    let effort = read_effort(app)?;
    let executable = coding_runtime::executable(app)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(match legacy(app)? {
        Some(s) => CodingConfig {
            id: s.id,
            enabled: s.enabled,
            base_url: s.base_url,
            model: s.model,
            has_key: !s.api_key.is_empty(),
            effort,
            executable,
            ignored_fields: ignored_fields(app)?,
        },
        None => CodingConfig {
            effort,
            executable,
            ignored_fields: ignored_fields(app)?,
            ..Default::default()
        },
    })
}
pub(super) fn ignored_fields(app: &AppHandle) -> Result<Vec<String>, DesktopFailure> {
    let text = match fs::read_to_string(filesystem_path(&owned(app, Path::new("config.toml"))?)) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(_) => return Err(DesktopFailure::operation_failed()),
    };
    let table: toml::Table = toml::from_str(&text).map_err(|_| DesktopFailure::invalid_input())?;
    // Do not report values or arbitrary key names that may themselves contain credentials.
    Ok([
        "model",
        "model_provider",
        "model_providers",
        "review_model",
        "api_key",
        "base_url",
        "env_key",
        "auth",
        "profile",
        "profiles",
    ]
    .into_iter()
    .filter(|key| table.contains_key(*key))
    .map(str::to_owned)
    .collect())
}
pub(super) fn read_effort(app: &AppHandle) -> Result<String, DesktopFailure> {
    let path = owned(app, Path::new("config.toml"))?;
    match fs::read_to_string(filesystem_path(&path)) {
        Ok(text) => {
            let config: toml::Table =
                toml::from_str(&text).map_err(|_| DesktopFailure::invalid_input())?;
            let value = config
                .get("model_reasoning_effort")
                .and_then(toml::Value::as_str)
                .unwrap_or("medium");
            if !["low", "medium", "high", "xhigh"].contains(&value) {
                return Err(DesktopFailure::invalid_input());
            }
            Ok(value.into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("medium".into()),
        Err(_) => Err(DesktopFailure::operation_failed()),
    }
}
pub(super) fn key(app: &AppHandle) -> Result<String, DesktopFailure> {
    if super::coding_catalog::exists(app)? {
        return super::coding_catalog::route(app, None).map(|(_, key)| key);
    }
    legacy(app)?
        .map(|s| s.api_key)
        .filter(|s| !s.is_empty())
        .ok_or_else(DesktopFailure::invalid_input)
}
pub(super) fn validate(draft: &CodingConfigDraft) -> Result<(), DesktopFailure> {
    if draft.base_url.len() > 2048
        || draft.model.len() > 256
        || draft.model.chars().any(char::is_whitespace)
        || !["low", "medium", "high", "xhigh"].contains(&draft.effort.as_str())
        || draft
            .api_key
            .as_ref()
            .is_some_and(|s| s.len() > 8192 || s.contains(['\r', '\n']))
    {
        return Err(DesktopFailure::invalid_input());
    }
    if draft.enabled || !draft.base_url.is_empty() {
        let url =
            reqwest::Url::parse(&draft.base_url).map_err(|_| DesktopFailure::invalid_input())?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path().trim_end_matches('/').ends_with("/responses")
            || url.path().contains("/chat/completions")
        {
            return Err(DesktopFailure::invalid_input());
        }
    }
    if draft.enabled && draft.model.is_empty() {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(())
}
pub(super) async fn save(
    app: &AppHandle,
    mut draft: CodingConfigDraft,
) -> Result<CodingConfig, DesktopFailure> {
    if super::coding_catalog::exists(app)? {
        return Err(DesktopFailure::conflict());
    }
    draft.base_url = draft.base_url.trim().trim_end_matches('/').to_owned();
    draft.model = draft.model.trim().to_owned();
    validate(&draft)?;
    let previous = legacy(app)?;
    let secret = draft.api_key.filter(|v| !v.is_empty()).unwrap_or_else(|| {
        previous
            .as_ref()
            .map(|s| s.api_key.clone())
            .unwrap_or_default()
    });
    if draft.enabled && secret.is_empty() {
        return Err(DesktopFailure::invalid_input());
    }
    let id = previous
        .as_ref()
        .filter(|s| s.base_url == draft.base_url && s.model == draft.model)
        .map(|s| s.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let config = StoredConfig {
        id,
        enabled: draft.enabled,
        base_url: draft.base_url,
        model: draft.model,
        api_key: secret,
    };
    let directory = root(app)?;
    coding_vault::private_directory(&directory)?;
    let encrypted = coding_vault::encrypt(
        &directory.join("vault"),
        &serde_json::to_vec(&config).map_err(|_| DesktopFailure::operation_failed())?,
        previous.is_none(),
    )?;
    let path = owned(app, Path::new("config.toml"))?;
    let text = match fs::read_to_string(filesystem_path(&path)) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => return Err(DesktopFailure::operation_failed()),
    };
    let mut document = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| DesktopFailure::invalid_input())?;
    document["model_reasoning_effort"] = toml_edit::value(draft.effort);
    write_bytes(&path, document.to_string().as_bytes())?;
    if let Err(error) = write_bytes(&directory.join("connection.enc"), &encrypted) {
        let rollback = write_bytes(&path, text.as_bytes());
        crate::diagnostics::log_client_event(&format!(
            "ERROR programming_config_save_rollback success={}",
            rollback.is_ok()
        ));
        return Err(error);
    }
    read(app)
}
pub(super) fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), DesktopFailure> {
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(filesystem_path(&temp))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
        drop(file);
        let _ = fs::remove_file(filesystem_path(&temp));
        return Err(DesktopFailure::operation_failed());
    }
    drop(file);
    let result = super::remote_config::replace_file(&temp, path);
    if result.is_err() {
        let _ = fs::remove_file(filesystem_path(&temp));
    }
    result
}
pub(super) fn write_json(path: &Path, value: &impl Serialize) -> Result<(), DesktopFailure> {
    write_bytes(
        path,
        &serde_json::to_vec(value).map_err(|_| DesktopFailure::operation_failed())?,
    )
}
#[cfg(test)]
#[path = "tests/coding_config.rs"]
mod tests;
