use super::{python_for_hermes, BackendState};
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;
use tokio::{process::Command, time::timeout};

const SCRIPT: &str = r#"import json, sys
from hermes_cli.config import load_config
from hermes_cli.personality import (
    active_personality_name, available_personalities,
    describe_personality, normalize_personality_name, persist_personality,
)

cfg = load_config() or {}
mode = sys.argv[1]
if mode == 'apply':
    name = normalize_personality_name(sys.argv[2])
    prompt = sys.argv[3]
    if prompt:
        if not name.startswith('hermess_'):
            raise SystemExit(2)
        existing = available_personalities(cfg)
        if name in existing and existing[name] != prompt:
            raise SystemExit(3)
        if name not in existing:
            from hermes_constants import get_hermes_home
            from utils import atomic_roundtrip_yaml_update
            atomic_roundtrip_yaml_update(get_hermes_home() / 'config.yaml',
                                         'agent.personalities.' + name, prompt)
        cfg = load_config() or {}
    if name and name not in available_personalities(cfg):
        raise SystemExit(2)
    if not persist_personality(name):
        raise SystemExit(1)
    cfg = load_config() or {}

root_custom = cfg.get('personalities') or {}
agent_custom = (cfg.get('agent') or {}).get('personalities') or {}
custom_names = set(root_custom if isinstance(root_custom, dict) else {}) | set(agent_custom if isinstance(agent_custom, dict) else {})
entries = [{'name': name, 'description': describe_personality(value, width=110),
            'source': 'custom' if name in custom_names else 'hermes'}
           for name, value in available_personalities(cfg).items()]
print(json.dumps({'active': active_personality_name(cfg) or 'none', 'entries': entries}, ensure_ascii=False))
"#;

async fn run(
    state: &State<'_, BackendState>,
    profile: &str,
    mode: &str,
    name: &str,
    prompt: &str,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(profile).await?;
    scope.ensure_current(state).await?;
    let mut command = Command::new(python_for_hermes(&scope.hermes).map_err(DesktopFailure::from)?);
    command
        .args(["-P", "-u", "-c", SCRIPT, mode, name, prompt])
        .env("HERMES_HOME", &scope.home)
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = timeout(Duration::from_secs(15), command.output())
        .await
        .map_err(|_| DesktopFailure::timeout())?
        .map_err(|_| DesktopFailure::operation_failed())?;
    scope.ensure_current(state).await?;
    if !output.status.success() {
        return Err(if output.status.code() == Some(3) {
            DesktopFailure::conflict()
        } else {
            DesktopFailure::operation_failed()
        });
    }
    let mut snapshot: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| DesktopFailure::operation_failed())?;
    snapshot["profile"] = json!(scope.profile);
    Ok(snapshot)
}

#[tauri::command]
pub async fn list_personalities(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    run(&state, &profile, "list", "", "").await
}

#[tauri::command]
pub async fn apply_personality(
    state: State<'_, BackendState>,
    profile: String,
    name: String,
    prompt: Option<String>,
) -> Result<Value, DesktopFailure> {
    let name = name.trim().to_lowercase();
    let prompt = prompt.unwrap_or_default();
    if name.len() > 64
        || name.chars().any(char::is_control)
        || prompt.len() > 4096
        || prompt.chars().any(|character| character == '\0')
    {
        return Err(DesktopFailure::invalid_input());
    }
    run(&state, &profile, "apply", &name, &prompt).await
}
