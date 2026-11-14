use super::{hermes_process_path, profile_scope::ResolvedProfileScope, BackendState};
use crate::{
    diagnostics::append_client_event,
    errors::DesktopFailure,
    paths::{filesystem_path, CanonicalizePlain},
    process_manager,
};
use serde_json::{json, Value};
use std::{ffi::OsString, path::Path, process::Stdio, time::Duration};
use tauri::State;
use tokio::process::Command;
use uuid::Uuid;

fn migration_args(
    profile: &str,
    source: &str,
    path: &Path,
    apply: bool,
) -> Result<Vec<OsString>, DesktopFailure> {
    if !matches!(
        source,
        "openclaw" | "claude-code" | "codex" | "cursor" | "grok-bot" | "openbot"
    ) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(vec![
        "-p".into(),
        profile.into(),
        "migrate".into(),
        source.into(),
        "--source".into(),
        path.as_os_str().to_owned(),
        if apply { "--yes" } else { "--dry-run" }.into(),
    ])
}

fn check_destination(home: &Path, source: &str) -> Result<(), DesktopFailure> {
    // These are the locked importer's output roots and its merge targets. Refuse links out of the Profile.
    let skill_directory = format!("skills/{source}-imports");
    for target in [
        "config.yaml",
        ".env",
        "SOUL.md",
        "memories",
        "memories/MEMORY.md",
        "memories/USER.md",
        "skills",
        &skill_directory,
        "cron",
        "cron/jobs.json",
        "backups",
        "migration",
        "import-sync.json",
        "grok-bot-import",
        "openbot-import",
    ] {
        let path = home.join(target);
        match std::fs::symlink_metadata(filesystem_path(&path)) {
            Ok(_)
                if path
                    .canonicalize_plain()
                    .is_ok_and(|resolved| resolved.starts_with(home)) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(DesktopFailure::conflict()),
        }
    }
    Ok(())
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let apply = match operation {
        "agent.migration.preview" => false,
        "agent.migration.apply" => true,
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let source = payload["source"]
        .as_str()
        .ok_or_else(DesktopFailure::invalid_input)?;
    let path = Path::new(
        payload["path"]
            .as_str()
            .ok_or_else(DesktopFailure::invalid_input)?,
    );
    if !path.is_absolute() {
        return Err(DesktopFailure::invalid_input());
    }
    let path = path
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::invalid_input())?;
    if !(filesystem_path(&path).is_dir()
        || matches!(source, "grok-bot" | "openbot") && filesystem_path(&path).is_file())
    {
        return Err(DesktopFailure::invalid_input());
    }
    let args = migration_args(&scope.profile, source, &path, apply)?;
    let id = Uuid::new_v4();
    let log = |phase| {
        let _ = append_client_event(&scope.storage, &format!("agent_migration operation={id} profile={} source={source} apply={apply} phase={phase}", scope.profile));
    };
    log("start");
    let result = async {
        let _guard = state.1.try_lock().map_err(|_| DesktopFailure::conflict())?;
        scope.ensure_current(state).await?;
        check_destination(&scope.owned_home()?, source)?;
        let mut command = Command::new(&scope.hermes);
        command
            .args(args)
            .env(
                "HERMES_HOME",
                hermes_process_path(&scope.storage.join("hermes-home")),
            )
            .env(
                "HERMES_GATEWAY_LOCK_DIR",
                hermes_process_path(&scope.storage.join("control").join("gateway-locks")),
            )
            .env("HERMES_DESKTOP", "1")
            .env("NO_COLOR", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let output = tokio::time::timeout(
            Duration::from_secs(180),
            process_manager::output(&mut command, "agent_migration"),
        )
        .await
        .map_err(|_| DesktopFailure::timeout())?
        .map_err(|_| DesktopFailure::operation_failed())?;
        scope.ensure_current(state).await?;
        // The upstream report lists destinations, conflicts and redacted secret names. Only show stdout in this dialog.
        let report: String = String::from_utf8_lossy(&output.stdout)
            .chars()
            .filter(|ch| !ch.is_control() || *ch == '\n' || *ch == '\t')
            .take(24_000)
            .collect();
        let ok = output.status.success() && !report.trim().is_empty();
        Ok::<Value, DesktopFailure>(json!({"ok": ok, "report": report}))
    }
    .await;
    log(
        if result.as_ref().is_ok_and(|result| result["ok"] == true) {
            "completed"
        } else {
            "failed"
        },
    );
    result
}

#[cfg(test)]
#[path = "tests/agent_migration.rs"]
mod tests;
