use super::{
    hermes_process_path, memory_provider_setup, profile_scope::ResolvedProfileScope, tools,
    BackendState,
};
use crate::{
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path},
    process_manager,
};
use reqwest::Method;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
    time::Duration,
};
use tauri::State;
use tokio::{process::Command, sync::Mutex, time::timeout};
use uuid::Uuid;

#[derive(Clone, Hash, PartialEq, Eq)]
struct RunKey {
    storage: PathBuf,
    profile: String,
    action: String,
}

#[derive(Clone)]
struct RunRecord {
    id: String,
    log: PathBuf,
    archive: Option<PathBuf>,
    subject: Option<String>,
    running: bool,
    exit_code: Option<i32>,
    error: Option<&'static str>,
}

static RUNS: OnceLock<Mutex<HashMap<RunKey, RunRecord>>> = OnceLock::new();

fn runs() -> &'static Mutex<HashMap<RunKey, RunRecord>> {
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn action_args(profile: &str, action: &str) -> Result<Vec<String>, DesktopFailure> {
    if action == "memory-provider-setup" {
        return Ok(Vec::new());
    }
    let mut args = vec!["-p".to_owned(), profile.to_owned()];
    match action {
        "doctor" => args.push("doctor".to_owned()),
        "security-audit" => args.extend(["security".to_owned(), "audit".to_owned()]),
        "checkpoints-prune" => args.extend([
            "checkpoints".to_owned(),
            "prune".to_owned(),
            "--force".to_owned(),
        ]),
        "backup" => args.push("backup".to_owned()),
        "restore" => args.push("import".to_owned()),
        "prompt-size" => args.push("prompt-size".to_owned()),
        "dump" => args.push("dump".to_owned()),
        "config-migrate" => args.extend(["config".to_owned(), "migrate".to_owned()]),
        "curator-run" => args.extend(["curator".to_owned(), "run".to_owned()]),
        "toolset-post-setup" => args.extend(["tools".to_owned(), "post-setup".to_owned()]),
        _ => return Err(DesktopFailure::invalid_input()),
    }
    Ok(args)
}

fn backup_args(profile: &str, archive: &Path) -> Result<Vec<String>, DesktopFailure> {
    let mut args = action_args(profile, "backup")?;
    args.extend(["-o".to_owned(), archive.to_string_lossy().into_owned()]);
    Ok(args)
}

fn restore_args(profile: &str, archive: &Path) -> Result<Vec<String>, DesktopFailure> {
    if profile != "default" {
        return Err(DesktopFailure::invalid_input());
    }
    let mut args = action_args(profile, "restore")?;
    args.extend([archive.to_string_lossy().into_owned(), "--force".to_owned()]);
    Ok(args)
}

fn toolset_setup_args(profile: &str, key: &str) -> Result<Vec<String>, DesktopFailure> {
    let mut args = action_args(profile, "toolset-post-setup")?;
    args.push(key.to_owned());
    Ok(args)
}

fn key(scope: &ResolvedProfileScope, action: &str) -> RunKey {
    RunKey {
        storage: scope.storage.clone(),
        profile: scope.profile.clone(),
        action: action.to_owned(),
    }
}

fn actions_conflict(requested: &str, running: &str) -> bool {
    requested == running
        || ((requested == "backup" || requested == "restore")
            && (running == "backup" || running == "restore"))
}

fn debug_share_body(payload: &Value) -> Result<Value, DesktopFailure> {
    let redact = payload
        .get("redact")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let lines = payload.get("lines").and_then(Value::as_u64).unwrap_or(200);
    if !(1..=5000).contains(&lines) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(json!({"redact": redact, "lines": lines}))
}

async fn debug_share(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let operation_id = Uuid::new_v4();
    let body = debug_share_body(payload)?;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "system_debug_share_start operation={operation_id} profile={} redacted={}",
            scope.profile,
            body["redact"].as_bool().unwrap_or(true)
        ),
    );
    let result = super::config::config_request_for_scope(
        state,
        scope,
        Method::POST,
        "/api/ops/debug-share",
        Some(body),
    )
    .await;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "system_debug_share_completed operation={operation_id} profile={} success={}",
            scope.profile,
            result.is_ok()
        ),
    );
    result
}

fn tail(path: &PathBuf) -> Result<Vec<String>, DesktopFailure> {
    let mut file =
        fs::File::open(filesystem_path(path)).map_err(|_| DesktopFailure::operation_failed())?;
    let len = file
        .metadata()
        .map_err(|_| DesktopFailure::operation_failed())?
        .len();
    file.seek(SeekFrom::Start(len.saturating_sub(128 * 1024)))
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut bytes = Vec::new();
    file.take(128 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|_| DesktopFailure::operation_failed())?;
    Ok(String::from_utf8_lossy(&bytes)
        .lines()
        .rev()
        .take(400)
        .map(str::to_owned)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect())
}

fn response(record: &RunRecord, lines: Vec<String>) -> Value {
    json!({"id": record.id, "running": record.running, "exit_code": record.exit_code,
        "error": record.error, "lines": lines, "subject": record.subject,
        "archive": record.archive.as_ref().and_then(|path| path.file_name()).map(|name| name.to_string_lossy().into_owned())})
}

fn valid_archive(path: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(filesystem_path(path)) else {
        return false;
    };
    if !meta.file_type().is_file() || meta.len() == 0 {
        return false;
    }
    let Ok(file) = fs::File::open(filesystem_path(path)) else {
        return false;
    };
    zip::ZipArchive::new(file).is_ok()
}

fn export_destination(raw: &str) -> Result<PathBuf, DesktopFailure> {
    if raw.is_empty() || raw.len() > 4096 || raw.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let path = plain_path(Path::new(raw));
    if !path.is_absolute()
        || path.components().any(|part| part == Component::ParentDir)
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(path)
}

fn restore_source(raw: &str) -> Result<PathBuf, DesktopFailure> {
    let path = export_destination(raw)?;
    let metadata = fs::symlink_metadata(filesystem_path(&path))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || !valid_archive(&path) {
        return Err(DesktopFailure::invalid_input());
    }
    let resolved = filesystem_path(&path)
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    Ok(plain_path(&resolved))
}

fn copy_backup(storage: &Path, archive: &Path, destination: &Path) -> Result<u64, DesktopFailure> {
    if fs::symlink_metadata(filesystem_path(archive))
        .map_err(|_| DesktopFailure::operation_failed())?
        .file_type()
        .is_symlink()
    {
        return Err(DesktopFailure::invalid_input());
    }
    let backup_dir = filesystem_path(&storage.join("hermes-home").join("backups"))
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let source = filesystem_path(archive)
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !source.starts_with(&backup_dir)
        || !valid_archive(&source)
        || source == filesystem_path(destination)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut input = fs::File::open(&source).map_err(|_| DesktopFailure::operation_failed())?;
    let target = filesystem_path(destination);
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|_| DesktopFailure::operation_failed())?;
    let result = io::copy(&mut input, &mut output).and_then(|bytes| {
        output.sync_all()?;
        Ok(bytes)
    });
    if result.is_err() {
        let _ = fs::remove_file(&target);
    }
    result.map_err(|_| DesktopFailure::operation_failed())
}

async fn export_backup(
    scope: &ResolvedProfileScope,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let id = payload
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?;
    let destination = export_destination(
        payload
            .get("destination")
            .and_then(Value::as_str)
            .ok_or_else(DesktopFailure::invalid_input)?,
    )?;
    let record = runs()
        .lock()
        .await
        .get(&key(scope, "backup"))
        .cloned()
        .ok_or_else(DesktopFailure::conflict)?;
    if record.id != id || record.running || record.exit_code != Some(0) || record.error.is_some() {
        return Err(DesktopFailure::conflict());
    }
    let archive = record
        .archive
        .ok_or_else(DesktopFailure::operation_failed)?;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "system_backup_export_start operation={id} profile={}",
            scope.profile
        ),
    );
    let storage = scope.storage.clone();
    let target = destination.clone();
    let result = tokio::task::spawn_blocking(move || copy_backup(&storage, &archive, &target))
        .await
        .unwrap_or_else(|_| Err(DesktopFailure::operation_failed()));
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "system_backup_export_completed operation={id} profile={} success={}",
            scope.profile,
            result.is_ok()
        ),
    );
    Ok(json!({"path": destination.to_string_lossy(), "bytes": result?}))
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    if payload
        .get("profile")
        .and_then(Value::as_str)
        .is_some_and(|value| value != scope.profile)
    {
        return Err(DesktopFailure::conflict());
    }
    if operation == "systemActions.debugShare" {
        return debug_share(state, scope, payload).await;
    }
    let action = payload
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?;
    let mut args = action_args(&scope.profile, action)?;
    if operation == "systemActions.start"
        && (action == "checkpoints-prune" || action == "config-migrate" || action == "restore")
        && payload.get("confirmed") != Some(&Value::Bool(true))
    {
        return Err(DesktopFailure::invalid_input());
    }
    scope.ensure_current(state).await?;
    let mut subject = None;
    if operation == "systemActions.start" && action == "toolset-post-setup" {
        let name = payload
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(DesktopFailure::invalid_input)?;
        let key = payload
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(DesktopFailure::invalid_input)?;
        tools::validate_post_setup_key(state, scope, name, key).await?;
        scope.ensure_current(state).await?;
        args = toolset_setup_args(&scope.profile, key)?;
        subject = Some(name.to_owned());
    }
    if operation == "systemActions.start" && action == "memory-provider-setup" {
        let provider = payload
            .get("provider")
            .and_then(Value::as_str)
            .filter(|value| memory_provider_setup::valid_provider_name(value))
            .ok_or_else(DesktopFailure::invalid_input)?;
        subject = Some(provider.to_owned());
    }
    if operation == "systemActions.start" && action == "restore" {
        let archive = restore_source(
            payload
                .get("archive")
                .and_then(Value::as_str)
                .ok_or_else(DesktopFailure::invalid_input)?,
        )?;
        args = restore_args(&scope.profile, &archive)?;
        subject = Some(archive.to_string_lossy().into_owned());
    }
    match operation {
        "systemActions.start" => start(scope, action, &args, subject).await,
        "systemActions.status" => status(scope, action, payload).await,
        "systemActions.exportBackup" if action == "backup" => export_backup(scope, payload).await,
        _ => Err(DesktopFailure::invalid_input()),
    }
}

async fn start(
    scope: &ResolvedProfileScope,
    action: &str,
    args: &[String],
    subject: Option<String>,
) -> Result<Value, DesktopFailure> {
    let key = key(scope, action);
    let id = Uuid::new_v4().to_string();
    let log_path = scope
        .storage
        .join("logs")
        .join("system-actions")
        .join(&scope.profile)
        .join(format!("{action}-{id}.log"));
    let archive = (action == "backup").then(|| {
        scope
            .storage
            .join("hermes-home")
            .join("backups")
            .join(format!("hermess-backup-{id}.zip"))
    });
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "system_action_start operation={id} profile={} action={action}",
            scope.profile
        ),
    );
    let result = async {
        let mut all = runs().lock().await;
        let conflicts = all.iter().any(|(candidate, run)| {
            candidate.storage == key.storage
                && candidate.profile == key.profile
                && actions_conflict(action, &candidate.action)
                && run.running
        });
        if conflicts {
            return Err(DesktopFailure::conflict());
        }
        let previous = all.get(&key).cloned();
        if let Some(path) = &archive {
            let dir = path.parent().ok_or_else(DesktopFailure::operation_failed)?;
            fs::create_dir_all(filesystem_path(dir)).map_err(|_| DesktopFailure::operation_failed())?;
        }
        let dir = log_path.parent().ok_or_else(DesktopFailure::operation_failed)?;
        fs::create_dir_all(filesystem_path(&dir)).map_err(|_| DesktopFailure::operation_failed())?;
        let mut log = fs::File::create(filesystem_path(&log_path))
            .map_err(|_| DesktopFailure::operation_failed())?;
        writeln!(log, "=== {action} operation={id} ===").map_err(|_| DesktopFailure::operation_failed())?;
        let stderr = log.try_clone().map_err(|_| DesktopFailure::operation_failed())?;
        let command_args = if let Some(path) = &archive {
            backup_args(&scope.profile, path)?
        } else {
            args.to_vec()
        };
        let mut command = if action == "memory-provider-setup" {
            memory_provider_setup::command(
                scope,
                subject
                    .as_deref()
                    .ok_or_else(DesktopFailure::invalid_input)?,
            )?
        } else {
            let mut command = Command::new(&scope.hermes);
            command.args(&command_args)
                .env("HERMES_HOME", hermes_process_path(&scope.storage.join("hermes-home")))
                .env("HERMES_GATEWAY_LOCK_DIR", hermes_process_path(&scope.storage.join("control").join("gateway-locks")))
                .env("HERMES_DESKTOP", "1")
                .env("HERMES_DISABLE_LAZY_INSTALLS", "1");
            command
        };
        command.stdin(Stdio::null()).stdout(Stdio::from(log)).stderr(Stdio::from(stderr))
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let (mut child, registration) = process_manager::spawn(&mut command, "system_action")
            .map_err(|_| DesktopFailure::operation_failed())?;
        let record = RunRecord { id: id.clone(), log: log_path.clone(), archive: archive.clone(), subject, running: true, exit_code: None, error: None };
        all.insert(key.clone(), record.clone());
        drop(all);
        if let Some(previous) = previous {
            if fs::remove_file(filesystem_path(&previous.log)).is_err() {
                let _ = crate::diagnostics::append_client_event(&scope.storage,
                    &format!("system_action_previous_log_cleanup_failed operation={id} profile={} action={action}", scope.profile));
            }
        }
        let storage = scope.storage.clone();
        let task_id = id.clone();
        let task_archive = archive.clone();
        let limit = if action == "backup" || action == "restore" { 3600 } else if action == "toolset-post-setup" || action == "memory-provider-setup" || action == "curator-run" { 1800 } else { 600 };
        tokio::spawn(async move {
            let (exit_code, mut error) = match timeout(Duration::from_secs(limit), child.wait()).await {
                Ok(Ok(status)) => (Some(status.code().unwrap_or(-1)), None),
                Ok(Err(_)) => (None, Some("wait_failed")),
                Err(_) => {
                    let _ = child.start_kill();
                    let _ = timeout(Duration::from_secs(5), child.wait()).await;
                    (None, Some("timeout"))
                }
            };
            drop(registration);
            if error.is_none() && exit_code == Some(0) && task_archive.as_ref().is_some_and(|path| !valid_archive(path)) {
                error = Some("backup_missing_or_invalid");
            }
            let mut all = runs().lock().await;
            if let Some(current) = all.get_mut(&key).filter(|run| run.id == task_id) {
                current.running = false;
                current.exit_code = exit_code;
                current.error = error;
            }
            drop(all);
            let _ = crate::diagnostics::append_client_event(&storage,
                &format!("system_action_completed operation={task_id} profile={} action={} exit_code={exit_code:?} error={error:?}", key.profile, key.action));
        });
        Ok(response(&record, Vec::new()))
    }.await;
    if let Err(error) = &result {
        if let Some(path) = &archive {
            let _ = fs::remove_file(filesystem_path(path));
        }
        if filesystem_path(&log_path).exists()
            && fs::remove_file(filesystem_path(&log_path)).is_err()
        {
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!(
                    "system_action_log_cleanup_failed operation={id} profile={} action={action}",
                    scope.profile
                ),
            );
        }
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "system_action_failed operation={id} profile={} action={action} error={error:?}",
                scope.profile
            ),
        );
    }
    result
}

async fn status(
    scope: &ResolvedProfileScope,
    action: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let record = runs().lock().await.get(&key(scope, action)).cloned();
    let Some(record) = record else {
        return Ok(Value::Null);
    };
    if payload
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|id| id != record.id)
    {
        return Err(DesktopFailure::conflict());
    }
    if payload
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(|name| record.subject.as_deref() != Some(name))
    {
        return Err(DesktopFailure::conflict());
    }
    Ok(response(&record, tail(&record.log)?))
}

#[cfg(test)]
#[path = "tests/system_actions.rs"]
mod tests;
