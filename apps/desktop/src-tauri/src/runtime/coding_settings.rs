use super::{coding_config, coding_vault};
use crate::{errors::DesktopFailure, paths::filesystem_path};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tauri::AppHandle;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpServer {
    pub id: String,
    pub enabled: bool,
    pub transport: String,
    pub command: String,
    pub url: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Instructions {
    pub developer_instructions: String,
    pub project_doc_max_bytes: u32,
    pub project_doc_fallback_filenames: Vec<String>,
}
impl Default for Instructions {
    fn default() -> Self {
        Self {
            developer_instructions: String::new(),
            project_doc_max_bytes: 32768,
            project_doc_fallback_filenames: vec![],
        }
    }
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub model_context_window: Option<u64>,
    pub model_auto_compact_token_limit: Option<u64>,
    pub tool_output_token_limit: Option<u64>,
    pub model_post_turn_compact_threshold_percent: Option<u64>,
    pub compact_prompt: String,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    #[serde(default)]
    pub config_path: String,
    pub revision: String,
    pub mcp_servers: Vec<McpServer>,
    pub disabled_skills: Vec<String>,
    pub instructions: Instructions,
    pub context: Context,
}
pub(super) fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_strings(values: &[String]) -> bool {
    values.len() <= 256 && values.iter().all(|s| s.len() <= 8192 && !s.contains('\0'))
}
pub(super) fn validate(settings: &mut Settings) -> Result<(), DesktopFailure> {
    let invalid = DesktopFailure::invalid_input;

    if settings.mcp_servers.len() > 64
        || !valid_strings(&settings.disabled_skills)
        || settings.instructions.developer_instructions.len() > 65536
        || settings.instructions.project_doc_max_bytes > 1024 * 1024
        || !valid_strings(&settings.instructions.project_doc_fallback_filenames)
        || settings.context.compact_prompt.len() > 32768
    {
        return Err(invalid());
    }
    for name in &settings.instructions.project_doc_fallback_filenames {
        if Path::new(name).components().count() != 1
            || name == "."
            || name == ".."
            || name.contains(['/', '\\', ':'])
        {
            return Err(invalid());
        }
    }
    for value in [
        settings.context.model_context_window,
        settings.context.model_auto_compact_token_limit,
        settings.context.tool_output_token_limit,
    ]
    .into_iter()
    .flatten()
    {
        if value == 0 || value > 100_000_000 {
            return Err(invalid());
        }
    }
    if settings
        .context
        .model_post_turn_compact_threshold_percent
        .is_some_and(|n| n > 100)
        || matches!((settings.context.model_auto_compact_token_limit, settings.context.model_context_window), (Some(limit), Some(window)) if limit > window)
    {
        return Err(invalid());
    }
    if serde_json::to_vec(settings).map_err(|_| invalid())?.len() > 1024 * 1024 {
        return Err(invalid());
    }
    Ok(())
}
fn source(app: &AppHandle) -> Result<String, DesktopFailure> {
    let path = coding_config::owned(app, Path::new("config.toml"))?;
    match fs::read_to_string(filesystem_path(&path)) {
        Ok(text) if text.len() <= 1024 * 1024 => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        _ => Err(DesktopFailure::operation_failed()),
    }
}
fn table(text: &str) -> Result<Value, DesktopFailure> {
    let value: toml::Table = toml::from_str(text).map_err(|_| DesktopFailure::invalid_input())?;
    let mut value = serde_json::to_value(value).map_err(|_| DesktopFailure::invalid_input())?;
    if cfg!(windows) {
        for server in value
            .get_mut("mcp_servers")
            .and_then(Value::as_object_mut)
            .into_iter()
            .flat_map(|servers| servers.values_mut())
        {
            for key in ["command", "cwd"] {
                if let Some(path) = server
                    .get(key)
                    .and_then(Value::as_str)
                    .filter(|path| Path::new(path).is_absolute())
                {
                    server[key] = json!(crate::paths::plain_path(Path::new(path)));
                }
            }
        }
        for skill in value
            .get_mut("skills")
            .and_then(|s| s.get_mut("config"))
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            if let Some(path) = skill
                .get("path")
                .and_then(Value::as_str)
                .filter(|path| Path::new(path).is_absolute())
            {
                skill["path"] = json!(crate::paths::plain_path(Path::new(path)));
            }
        }
    }
    Ok(value)
}
fn parse(text: &str) -> Result<Settings, DesktopFailure> {
    let raw = table(text)?;
    let mut settings = Settings::default();
    settings.revision = revision(text.as_bytes());
    if let Some(servers) = raw.get("mcp_servers") {
        for (id, config) in servers
            .as_object()
            .ok_or_else(DesktopFailure::invalid_input)?
        {
            let config = config
                .as_object()
                .ok_or_else(DesktopFailure::invalid_input)?;
            settings.mcp_servers.push(serde_json::from_value(json!({"id":id, "enabled":config.get("enabled").cloned().unwrap_or(json!(true)),
                "transport":if config.contains_key("command") {"stdio"} else {"http"}, "command":config.get("command").cloned().unwrap_or(json!("")),
                "url":config.get("url").cloned().unwrap_or(json!(""))})).map_err(|_| DesktopFailure::invalid_input())?);
        }
    }
    if let Some(entries) = raw
        .get("skills")
        .and_then(|s| s.get("config"))
        .and_then(Value::as_array)
    {
        settings.disabled_skills = entries
            .iter()
            .filter(|entry| entry["enabled"] == false)
            .filter_map(|entry| entry["path"].as_str().map(str::to_owned))
            .collect();
    }
    let mut instructions = serde_json::to_value(Instructions::default())
        .map_err(|_| DesktopFailure::operation_failed())?;
    let keys: Vec<String> = instructions.as_object().unwrap().keys().cloned().collect();
    for key in keys {
        if let Some(value) = raw.get(&key) {
            instructions[&key] = value.clone();
        }
    }
    settings.instructions =
        serde_json::from_value(instructions).map_err(|_| DesktopFailure::invalid_input())?;
    let mut context =
        serde_json::to_value(Context::default()).map_err(|_| DesktopFailure::operation_failed())?;
    let keys: Vec<String> = context.as_object().unwrap().keys().cloned().collect();
    for key in keys {
        if let Some(value) = raw.get(&key) {
            context[&key] = value.clone();
        }
    }
    settings.context =
        serde_json::from_value(context).map_err(|_| DesktopFailure::invalid_input())?;
    validate(&mut settings)?;
    Ok(settings)
}
pub(super) fn load(app: &AppHandle) -> Result<Settings, DesktopFailure> {
    let mut settings = parse(&source(app)?)?;
    settings.config_path = coding_config::owned(app, Path::new("config.toml"))?
        .to_string_lossy()
        .into_owned();
    Ok(settings)
}
pub(super) fn save(app: &AppHandle, mut draft: Settings) -> Result<Settings, DesktopFailure> {
    let operation = uuid::Uuid::new_v4();
    coding_config::log(
        app,
        &format!("programming_settings_save_start operation={operation}"),
    );
    let result = (|| {
        let text = source(app)?;
        let current = parse(&text)?;
        if current.revision != draft.revision {
            return Err(DesktopFailure::conflict());
        }
        validate(&mut draft)?;
        // MCP and skill activation are file-owned. These pages only display them.
        if serde_json::to_value(&current.mcp_servers).ok()
            != serde_json::to_value(&draft.mcp_servers).ok()
            || current.disabled_skills != draft.disabled_skills
        {
            return Err(DesktopFailure::invalid_input());
        }
        let mut document = text
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| DesktopFailure::invalid_input())?;
        document["developer_instructions"] =
            toml_edit::value(draft.instructions.developer_instructions);
        document["project_doc_max_bytes"] =
            toml_edit::value(i64::from(draft.instructions.project_doc_max_bytes));
        let mut filenames = toml_edit::Array::new();
        for name in draft.instructions.project_doc_fallback_filenames {
            filenames.push(name);
        }
        document["project_doc_fallback_filenames"] = toml_edit::value(filenames);
        let context =
            serde_json::to_value(draft.context).map_err(|_| DesktopFailure::operation_failed())?;
        for (key, value) in context.as_object().unwrap() {
            if value.is_null() || value.as_str() == Some("") {
                document.remove(key);
            } else if let Some(value) = value.as_i64() {
                document[key] = toml_edit::value(value);
            } else if let Some(value) = value.as_str() {
                document[key] = toml_edit::value(value);
            }
        }
        let updated = document.to_string();
        let mut settings = parse(&updated)?;
        settings.config_path = coding_config::owned(app, Path::new("config.toml"))?
            .to_string_lossy()
            .into_owned();
        coding_vault::private_directory(&coding_config::root(app)?)?;
        coding_config::write_bytes(
            &coding_config::owned(app, Path::new("config.toml"))?,
            updated.as_bytes(),
        )?;
        Ok(settings)
    })();
    coding_config::log(
        app,
        &format!(
            "{}programming_settings_save_result operation={operation} success={}",
            if result.is_err() { "ERROR " } else { "" },
            result.is_ok()
        ),
    );
    result
}
pub(super) fn payload(app: &AppHandle) -> Result<Value, DesktopFailure> {
    let text = source(app)?;
    let settings = parse(&text)?;
    let raw = table(&text)?;
    let mut names = std::collections::BTreeSet::new();
    for config in raw
        .get("mcp_servers")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|servers| servers.values())
    {
        if let Some(name) = config.get("bearer_token_env_var").and_then(Value::as_str) {
            names.insert(name.to_owned());
        }
        for name in config
            .get("env_http_headers")
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|headers| headers.values())
            .filter_map(Value::as_str)
        {
            names.insert(name.to_owned());
        }
        for entry in config
            .get("env_vars")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(name) = entry.as_str().or_else(|| {
                if entry["source"] == "local" {
                    entry["name"].as_str()
                } else {
                    None
                }
            }) {
                names.insert(name.to_owned());
            }
        }
    }
    let mcp_environment: std::collections::BTreeMap<String, String> = names
        .into_iter()
        .filter(|name| {
            let upper = name.to_ascii_uppercase();
            ![
                "HOME",
                "USERPROFILE",
                "LOCALAPPDATA",
                "APPDATA",
                "PYTHONPATH",
                "PYTHONHOME",
                "BASH_ENV",
                "ENV",
                "ZDOTDIR",
            ]
            .contains(&upper.as_str())
                && !["CODEX_", "HERMES_", "HERMESS_"]
                    .iter()
                    .any(|prefix| upper.starts_with(prefix))
        })
        .filter_map(|name| std::env::var(&name).ok().map(|value| (name, value)))
        .collect();
    Ok(
        json!({"settings":settings,"mcp_config":raw.get("mcp_servers").cloned().unwrap_or(json!({})),"mcp_environment":mcp_environment,"skills_config":raw.get("skills").cloned().unwrap_or(json!({})),
        "skill_root":coding_config::owned(app, Path::new("skills"))?, "oauth_root":coding_config::owned(app, Path::new("mcp-auth"))?}),
    )
}

#[cfg(test)]
#[path = "tests/coding_settings.rs"]
mod tests;
