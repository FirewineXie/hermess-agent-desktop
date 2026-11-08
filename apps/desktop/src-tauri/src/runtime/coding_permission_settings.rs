use super::{coding_config, coding_vault};
use crate::{errors::DesktopFailure, paths::filesystem_path};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tauri::AppHandle;

const BUILTINS: [&str; 5] = [
    "hermess",
    "hermess-readonly",
    ":workspace",
    ":read-only",
    ":danger-full-access",
];
const POLICIES: [&str; 2] = ["on-request", "never"];

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PermissionDraft {
    revision: String,
    default_permissions: String,
    approval_policy: String,
    approvals_reviewer: String,
    #[serde(default)]
    network_access: Option<bool>,
    #[serde(default)]
    writable_roots: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct PermissionSettings {
    #[serde(flatten)]
    draft: PermissionDraft,
    profiles: Vec<String>,
    profile_rules: std::collections::BTreeMap<String, ProfileRules>,
}

#[derive(Serialize)]
struct ProfileRules {
    network_access: Option<bool>,
    writable_roots: Vec<String>,
}

fn rules(table: &toml::Table, profile: &str) -> ProfileRules {
    let get = |name: &str| table.get("permissions").and_then(|p| p.get(name));
    let writable_roots = get(profile)
        .and_then(|p| p.get("filesystem"))
        .and_then(toml::Value::as_table)
        .map(|fs| {
            fs.iter()
                .filter(|(key, value)| {
                    Path::new(key).is_absolute() && value.as_str() == Some("write")
                })
                .map(|(key, _)| key.clone())
                .collect()
        })
        .unwrap_or_default();
    let mut current = profile;
    let mut network_access = Some(false);
    for _ in 0..32 {
        if current == ":danger-full-access" {
            network_access = None;
            break;
        }
        let Some(config) = get(current) else {
            break;
        };
        if let Some(enabled) = config
            .get("network")
            .and_then(|n| n.get("enabled"))
            .and_then(toml::Value::as_bool)
        {
            network_access = Some(enabled);
            break;
        }
        let Some(base) = config.get("extends").and_then(toml::Value::as_str) else {
            break;
        };
        current = base;
    }
    ProfileRules {
        network_access,
        writable_roots,
    }
}

fn text(path: &Path) -> Result<String, DesktopFailure> {
    match fs::read_to_string(filesystem_path(path)) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(_) => Err(DesktopFailure::operation_failed()),
    }
}

fn field<'a>(
    table: &'a toml::Table,
    name: &str,
    default: &'a str,
) -> Result<&'a str, DesktopFailure> {
    match table.get(name) {
        None => Ok(default),
        Some(value) => value.as_str().ok_or_else(DesktopFailure::invalid_input),
    }
}

fn parse(text: &str) -> Result<PermissionSettings, DesktopFailure> {
    let table: toml::Table = toml::from_str(text).map_err(|_| DesktopFailure::invalid_input())?;
    let legacy = match field(&table, "sandbox_mode", "")? {
        "read-only" => ":read-only",
        "workspace-write" => ":workspace",
        "danger-full-access" => ":danger-full-access",
        _ => "hermess",
    };
    let profile = field(&table, "default_permissions", legacy)?;
    // The worker uses a legacy sandbox mode only when no named profile is selected.
    let profile = if profile.is_empty() { legacy } else { profile };
    let mut profiles: Vec<String> = BUILTINS.into_iter().map(str::to_owned).collect();
    if let Some(custom) = table.get("permissions") {
        let custom = custom
            .as_table()
            .ok_or_else(DesktopFailure::invalid_input)?;
        for (name, value) in custom {
            if !value.is_table() {
                return Err(DesktopFailure::invalid_input());
            }
            if !profiles.contains(name) {
                profiles.push(name.clone());
            }
        }
    }
    let policy = field(&table, "approval_policy", "on-request")?;
    let reviewer = field(&table, "approvals_reviewer", "user")?;
    let reviewer = if reviewer == "guardian_subagent" {
        "auto_review"
    } else {
        reviewer
    };
    if !profiles.iter().any(|item| item == profile)
        || !(POLICIES.contains(&policy) || ["on-failure", "untrusted"].contains(&policy))
        || !["user", "auto_review"].contains(&reviewer)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let profile_rules = profiles
        .iter()
        .map(|name| (name.clone(), rules(&table, name)))
        .collect();
    let selected = rules(&table, profile);
    Ok(PermissionSettings {
        draft: PermissionDraft {
            revision: format!("{:x}", Sha256::digest(text.as_bytes())),
            default_permissions: profile.into(),
            approval_policy: policy.into(),
            approvals_reviewer: reviewer.into(),
            network_access: selected.network_access,
            writable_roots: selected.writable_roots,
        },
        profiles,
        profile_rules,
    })
}

pub(super) fn read(app: &AppHandle) -> Result<PermissionSettings, DesktopFailure> {
    parse(&text(&coding_config::owned(
        app,
        Path::new("config.toml"),
    )?)?)
}

fn save_at(path: &Path, draft: PermissionDraft) -> Result<PermissionSettings, DesktopFailure> {
    let original = text(path)?;
    let current = parse(&original)?;
    if draft.revision != current.draft.revision {
        return Err(DesktopFailure::conflict());
    }
    if !current.profiles.contains(&draft.default_permissions)
        || !POLICIES.contains(&draft.approval_policy.as_str())
        || !["user", "auto_review"].contains(&draft.approvals_reviewer.as_str())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut document = original
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| DesktopFailure::invalid_input())?;
    let mut profile = draft.default_permissions.clone();
    if profile != ":danger-full-access"
        && (draft.network_access.is_some() || !draft.writable_roots.is_empty())
    {
        if profile.starts_with(':') {
            profile = format!("hermess-settings-{}", profile.trim_start_matches(':'));
            document["permissions"][&profile]["extends"] =
                toml_edit::value(draft.default_permissions);
        }
        if let Some(enabled) = draft.network_access {
            document["permissions"][&profile]["network"]["enabled"] = toml_edit::value(enabled);
        }
        if let Some(table) = document["permissions"][&profile]["filesystem"].as_table_like_mut() {
            let removed: Vec<String> = table
                .iter()
                .filter(|(key, value)| {
                    Path::new(key).is_absolute() && value.as_str() == Some("write")
                })
                .map(|(key, _)| key.to_owned())
                .collect();
            for key in removed {
                table.remove(&key);
            }
        }
        if draft.writable_roots.len() > 64 {
            return Err(DesktopFailure::invalid_input());
        }
        for root in draft.writable_roots {
            let root = super::chat_create::validate_workspace_path(Some(root))?
                .ok_or_else(DesktopFailure::invalid_input)?;
            document["permissions"][&profile]["filesystem"][&root] = toml_edit::value("write");
        }
    }
    document["default_permissions"] = toml_edit::value(profile);
    document["approval_policy"] = toml_edit::value(draft.approval_policy);
    document["approvals_reviewer"] = toml_edit::value(draft.approvals_reviewer);
    let updated = document.to_string();
    let result = parse(&updated)?;
    coding_config::write_bytes(path, updated.as_bytes())?;
    Ok(result)
}

pub(super) fn save(
    app: &AppHandle,
    draft: PermissionDraft,
) -> Result<PermissionSettings, DesktopFailure> {
    let operation = uuid::Uuid::new_v4();
    coding_config::log(
        app,
        &format!("programming_permission_settings_save_start operation={operation}"),
    );
    let result = (|| {
        coding_vault::private_directory(&coding_config::root(app)?)?;
        save_at(&coding_config::owned(app, Path::new("config.toml"))?, draft)
    })();
    coding_config::log(
        app,
        &format!(
            "{}programming_permission_settings_save_result operation={operation} success={}",
            if result.is_err() { "ERROR " } else { "" },
            result.is_ok()
        ),
    );
    result
}

#[cfg(test)]
#[path = "tests/coding_permission_settings.rs"]
mod tests;
