use super::hermes_process_path;
use crate::{errors::DesktopFailure, process_manager};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{process::Command, time::timeout};
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfilePresetSelection {
    pub(super) personality_name: String,
    pub(super) personality_prompt: String,
    pub(super) skills: Vec<String>,
    pub(super) mcp: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileCreateOptions {
    pub(super) preset: Option<ProfilePresetSelection>,
    pub(super) clone_from: Option<String>,
    #[serde(default)]
    pub(super) clone_all: bool,
    pub(super) description: Option<String>,
    pub(super) provider: Option<String>,
    pub(super) model: Option<String>,
    #[serde(default)]
    pub(super) no_skills: bool,
    pub(super) keep_skills: Option<Vec<String>>,
    pub(super) hub_skills: Option<Vec<String>>,
    pub(super) mcp_servers: Option<Vec<ProfileMcpServerCreate>>,
}

pub(super) fn validate_preset(preset: &ProfilePresetSelection) -> Result<(), DesktopFailure> {
    let valid_name = |value: &str, max: usize, allowed: fn(u8) -> bool| {
        !value.is_empty() && value.len() <= max && value.bytes().all(allowed)
    };
    if !preset.personality_name.starts_with("hermess_")
        || !valid_name(&preset.personality_name, 64, |byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
        })
        || preset.personality_prompt.is_empty()
        || preset.personality_prompt.len() > 4096
        || preset.skills.len() > 16
        || preset.mcp.len() > 8
        || preset.skills.iter().any(|skill| {
            !valid_name(skill, 100, |byte| {
                byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
            })
        })
        || preset.mcp.iter().any(|name| {
            !valid_name(name, 80, |byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
            })
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(())
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct ProfileMcpServerCreate {
    name: String,
    url: Option<String>,
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: std::collections::BTreeMap<String, String>,
    auth: Option<String>,
    bearer_token: Option<String>,
}

#[derive(Serialize)]
struct ProfileCreatePayload<'a> {
    name: &'a str,
    preset: Option<&'a ProfilePresetSelection>,
    clone_from: Option<&'a str>,
    clone_all: bool,
    description: Option<&'a str>,
    provider: Option<&'a str>,
    model: Option<&'a str>,
    no_skills: bool,
    keep_skills: &'a [String],
    hub_skills: &'a [String],
    mcp_servers: &'a [ProfileMcpServerCreate],
    soul: Option<&'a str>,
}

pub(super) fn create_payload(
    name: &str,
    options: Option<&ProfileCreateOptions>,
    soul: Option<&str>,
) -> Value {
    let empty_strings: Vec<String> = Vec::new();
    let empty_mcp: Vec<ProfileMcpServerCreate> = Vec::new();
    let payload = ProfileCreatePayload {
        name,
        preset: options.and_then(|value| value.preset.as_ref()),
        clone_from: options.and_then(|value| value.clone_from.as_deref()),
        clone_all: options.is_some_and(|value| value.clone_all),
        description: options.and_then(|value| value.description.as_deref()),
        provider: options.and_then(|value| value.provider.as_deref()),
        model: options.and_then(|value| value.model.as_deref()),
        no_skills: options.is_some_and(|value| value.no_skills),
        keep_skills: options
            .and_then(|value| value.keep_skills.as_ref())
            .unwrap_or(&empty_strings),
        hub_skills: options
            .and_then(|value| value.hub_skills.as_ref())
            .unwrap_or(&empty_strings),
        mcp_servers: options
            .and_then(|value| value.mcp_servers.as_ref())
            .unwrap_or(&empty_mcp),
        soul,
    };
    serde_json::to_value(payload).unwrap_or(Value::Null)
}

fn clean(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

fn valid_skill_name(value: &str) -> bool {
    clean(value, 100)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn valid_mcp(server: &ProfileMcpServerCreate) -> bool {
    if !clean(&server.name, 100) || server.args.len() > 128 || server.env.len() > 64 {
        return false;
    }
    let has_url = server
        .url
        .as_deref()
        .is_some_and(|value| clean(value, 2048));
    let has_command = server
        .command
        .as_deref()
        .is_some_and(|value| clean(value, 2048));
    if has_url == has_command {
        return false;
    }
    if let Some(raw) = server.url.as_deref() {
        let Ok(url) = Url::parse(raw) else {
            return false;
        };
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return false;
        }
    }
    if server
        .args
        .iter()
        .any(|value| value.len() > 4096 || value.contains('\0'))
        || server
            .env
            .iter()
            .any(|(key, value)| !valid_env_key(key) || value.len() > 16_384 || value.contains('\0'))
    {
        return false;
    }
    let auth = server.auth.as_deref().unwrap_or("none");
    if !matches!(auth, "none" | "oauth" | "header") || !has_url && auth != "none" {
        return false;
    }
    match (auth, server.bearer_token.as_deref()) {
        ("header", Some(token)) => clean(token, 16_384),
        ("header", None) => false,
        (_, Some(_)) => false,
        _ => true,
    }
}

fn valid_env_key(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

pub(super) fn validate_builder_options(
    options: &ProfileCreateOptions,
) -> Result<(), DesktopFailure> {
    let provider = options
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let model = options
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if provider.is_some() != model.is_some()
        || provider.is_some_and(|value| !clean(value, 200))
        || model.is_some_and(|value| !clean(value, 500))
        || options.no_skills && (options.clone_from.is_some() || options.clone_all)
        || options.no_skills
            && options
                .keep_skills
                .as_ref()
                .is_some_and(|items| !items.is_empty())
        || options.keep_skills.as_ref().is_some_and(|items| {
            items.len() > 256 || items.iter().any(|item| !valid_skill_name(item))
        })
        || options
            .hub_skills
            .as_ref()
            .is_some_and(|items| items.len() > 16 || items.iter().any(|item| !clean(item, 500)))
        || options
            .mcp_servers
            .as_ref()
            .is_some_and(|items| items.len() > 16 || items.iter().any(|item| !valid_mcp(item)))
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(())
}

pub(super) fn write_payload(storage: &Path, payload: &Value) -> Result<PathBuf, DesktopFailure> {
    let directory = storage.join("control").join("profile-create");
    fs::create_dir_all(&directory).map_err(|_| DesktopFailure::operation_failed())?;
    let path = directory.join(format!("{}.json", Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&path)
        .map_err(|_| DesktopFailure::operation_failed())?;
    let bytes = serde_json::to_vec(payload).map_err(|_| DesktopFailure::invalid_input())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| DesktopFailure::operation_failed())?;
    Ok(path)
}

pub(super) async fn spawn_hub_installs(
    hermes: &Path,
    storage: &Path,
    home: &Path,
    lock_dir: &Path,
    profile: &str,
    identifiers: &[String],
) -> (Vec<Value>, Vec<String>) {
    let mut installs = Vec::new();
    let mut warnings = Vec::new();
    for identifier in identifiers {
        let id = Uuid::new_v4().to_string();
        let action = format!("profile-hub-install-{id}");
        let log_path = storage
            .join("logs")
            .join("profile-create")
            .join(format!("{action}.log"));
        let result = (|| -> Result<_, DesktopFailure> {
            fs::create_dir_all(
                log_path
                    .parent()
                    .ok_or_else(DesktopFailure::operation_failed)?,
            )
            .map_err(|_| DesktopFailure::operation_failed())?;
            let stdout =
                fs::File::create(&log_path).map_err(|_| DesktopFailure::operation_failed())?;
            let stderr = stdout
                .try_clone()
                .map_err(|_| DesktopFailure::operation_failed())?;
            let mut command = Command::new(hermes);
            command
                .args(["-p", profile, "skills", "install", identifier, "--yes"])
                .env("HERMES_HOME", hermes_process_path(home))
                .env("HERMES_GATEWAY_LOCK_DIR", hermes_process_path(lock_dir))
                .env("HERMES_DESKTOP", "1")
                .env("HERMES_DISABLE_LAZY_INSTALLS", "1")
                .stdin(Stdio::null())
                .stdout(Stdio::from(stdout))
                .stderr(Stdio::from(stderr))
                .kill_on_drop(true);
            #[cfg(windows)]
            command.creation_flags(0x0800_0000);
            process_manager::spawn(&mut command, "profile_hub_install")
                .map_err(|_| DesktopFailure::operation_failed())
        })();
        match result {
            Ok((mut child, registration)) => {
                let operation = action.clone();
                let operation_profile = profile.to_owned();
                let operation_storage = storage.to_owned();
                let _ = crate::diagnostics::append_client_event(storage, &format!(
                    "profile_hub_install_start operation={operation} profile={profile} identifier={identifier}"
                ));
                tokio::spawn(async move {
                    let outcome = match timeout(Duration::from_secs(600), child.wait()).await {
                        Ok(Ok(status)) => format!("exit={}", status.code().unwrap_or(-1)),
                        Ok(Err(_)) => "wait_failed".into(),
                        Err(_) => {
                            let _ = child.start_kill();
                            let _ = timeout(Duration::from_secs(5), child.wait()).await;
                            "timeout".into()
                        }
                    };
                    drop(registration);
                    let _ = crate::diagnostics::append_client_event(&operation_storage, &format!(
                        "profile_hub_install_finish operation={operation} profile={operation_profile} result={outcome}"
                    ));
                });
                installs.push(json!({"identifier": identifier, "action": action}));
            }
            Err(_) => {
                warnings.push(format!("hub:{identifier}"));
                installs.push(json!({"identifier": identifier, "action": null}));
            }
        }
    }
    (installs, warnings)
}

/// Runs inside the locked Hermes interpreter. Profile construction stays atomic and uses the
/// locked implementation; the desktop only suppresses implicit model seeding and retries the
/// observed transient Windows directory-rename denial.
pub(super) const CREATE_PROFILE_SCRIPT: &str = r#"import json, os, sys, time
from pathlib import Path
from hermes_cli import profiles as profile_api
from hermes_cli.profiles import normalize_profile_name, seed_profile_skills
name = normalize_profile_name(sys.argv[1])
p = Path(sys.argv[2])
options = json.loads(p.read_text(encoding='utf-8')) or {}
try:
    p.unlink()
except OSError:
    pass
soul = options.get('soul')
preset = options.get('preset')
clone_from = options.get('clone_from')
clone_all = bool(options.get('clone_all'))
description = options.get('description')
if not callable(getattr(profile_api, '_seed_model_config', None)):
    raise RuntimeError('Hermes profile model seeding hook is unavailable')
profile_api._seed_model_config = lambda _path: None
windows_rename_retries = 0
while True:
    try:
        path = profile_api.create_profile(name, clone_from=clone_from, clone_all=clone_all,
            clone_config=bool(clone_from and not clone_all), no_alias=True, clone_channels=False,
            no_skills=bool(options.get('no_skills')) or soul is not None, description=description, soul=soul)
        break
    except PermissionError as exc:
        if os.name != 'nt' or getattr(exc, 'winerror', None) != 5 or windows_rename_retries >= 2:
            raise
        windows_rename_retries += 1
        time.sleep(0.15 * windows_rename_retries)
if not clone_from:
    seed_profile_skills(path, quiet=True)
warnings = []
personality_applied = False
provider = (options.get('provider') or '').strip()
model = (options.get('model') or '').strip()
if provider and model:
    try:
        from hermes_cli.web_routers.profiles import _write_profile_model
        _write_profile_model(path, provider, model, validate_in=Path(os.environ['HERMES_HOME']))
    except Exception:
        warnings.append('model')
servers = options.get('mcp_servers') or []
if servers:
    try:
        from hermes_cli.web_models import MCPServerCreate
        from hermes_cli.web_server_profiles import _write_profile_mcp_servers
        written = _write_profile_mcp_servers(path, [MCPServerCreate(**server) for server in servers])
        if written != len(servers):
            warnings.append('mcp')
    except Exception:
        warnings.append('mcp')
keep_skills = options.get('keep_skills') or []
if keep_skills:
    try:
        from hermes_cli.web_routers.profiles import _disable_unselected_skills
        _disable_unselected_skills(path, keep_skills)
    except Exception:
        warnings.append('skills')
if preset:
    try:
        from utils import atomic_roundtrip_yaml_update
        config_path = path / 'config.yaml'
        personality = preset['personalityName']
        atomic_roundtrip_yaml_update(config_path, 'agent.personalities.' + personality,
                                     preset['personalityPrompt'])
        atomic_roundtrip_yaml_update(config_path, 'display.personality', personality)
        personality_applied = True
    except Exception:
        warnings.append('personality')
    try:
        from agent.skill_utils import ESSENTIAL_SKILLS
        skills_root = path / 'skills'
        installed = {entry.parent.name for entry in skills_root.rglob('SKILL.md')} if skills_root.is_dir() else set()
        requested = set(preset['skills'])
        missing = sorted(requested - installed)
        if missing:
            warnings.append('skills_missing:' + ','.join(missing))
        disabled = sorted(installed - requested - ESSENTIAL_SKILLS)
        atomic_roundtrip_yaml_update(path / 'config.yaml', 'skills.disabled', disabled)
    except Exception:
        warnings.append('skills')
    if preset['mcp']:
        import os, subprocess
        mcp_script = '''import sys
from hermes_cli.mcp_catalog import get_entry, card_install_config
from hermes_cli.mcp_config import _save_mcp_server
entry = get_entry(sys.argv[1])
if entry is None or entry.install is not None or entry.auth.type != "none" or entry.auth.env:
    raise SystemExit(2)
if not _save_mcp_server(entry.name, card_install_config(entry)):
    raise SystemExit(3)
'''
        for mcp_name in preset['mcp']:
            try:
                result = subprocess.run([sys.executable, '-c', mcp_script, mcp_name],
                    env={**os.environ, 'HERMES_HOME': str(path)},
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, timeout=20, check=False)
                if result.returncode != 0:
                    warnings.append('mcp:' + mcp_name)
            except Exception:
                warnings.append('mcp:' + mcp_name)
print(json.dumps({'name': name, 'personality_applied': personality_applied, 'warnings': warnings,
                  'windows_rename_retries': windows_rename_retries}))
"#;

#[cfg(test)]
#[path = "tests/profile_create_adapter.rs"]
mod tests;
