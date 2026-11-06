use super::{helper_python, profile_scope::valid_profile_name, BackendState};
use crate::{
    diagnostics::append_client_event,
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path},
    process_manager,
};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use tokio::time::timeout;

const EXPORT_SCRIPT: &str = r#"import json, sys
from hermes_cli.profiles import export_profile
archive = export_profile(sys.argv[1], sys.argv[2])
print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size}))
"#;

const IMPORT_SCRIPT: &str = r#"import json, sys
from hermes_cli.profiles import import_profile
name = json.loads(sys.argv[2])
path = import_profile(sys.argv[1], name=name)
print(json.dumps({'name': path.name}))
"#;

fn import_archive_extension(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            let lower = name.to_ascii_lowercase();
            lower.ends_with(".tar.gz") || lower.ends_with(".tgz")
        })
}

fn export_archive_extension(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".tar.gz"))
}

fn validate_export_destination(path: &Path) -> Result<(), DesktopFailure> {
    if !path.is_absolute()
        || !export_archive_extension(path)
        || fs::symlink_metadata(filesystem_path(path)).is_ok()
    {
        return Err(DesktopFailure::invalid_input());
    }
    let parent = path.parent().ok_or_else(DesktopFailure::invalid_input)?;
    let metadata = fs::symlink_metadata(filesystem_path(parent))
        .map_err(|_| DesktopFailure::invalid_input())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(())
}

fn copy_new(source: &Path, destination: &Path) -> Result<u64, DesktopFailure> {
    let mut input =
        fs::File::open(filesystem_path(source)).map_err(|_| DesktopFailure::operation_failed())?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(filesystem_path(destination))
        .map_err(|_| DesktopFailure::conflict())?;
    match io::copy(&mut input, &mut output) {
        Ok(bytes) => Ok(bytes),
        Err(_) => {
            drop(output);
            let _ = fs::remove_file(filesystem_path(destination));
            Err(DesktopFailure::operation_failed())
        }
    }
}

fn validate_import_archive(path: &Path) -> Result<(), DesktopFailure> {
    if !path.is_absolute() || !import_archive_extension(path) {
        return Err(DesktopFailure::invalid_input());
    }
    let metadata =
        fs::symlink_metadata(filesystem_path(path)).map_err(|_| DesktopFailure::invalid_input())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(())
}

async fn runtime_paths(
    state: &State<'_, BackendState>,
) -> Result<(std::path::PathBuf, std::path::PathBuf, std::path::PathBuf), DesktopFailure> {
    let owned = state.0.lock().await;
    let backend = owned
        .as_ref()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    Ok((
        backend.hermes.clone(),
        backend.storage.clone(),
        backend.storage.join("hermes-home"),
    ))
}

#[tauri::command]
pub async fn export_profile_archive(
    state: State<'_, BackendState>,
    name: String,
    destination: String,
) -> Result<Value, DesktopFailure> {
    let name = name.trim();
    let destination = Path::new(destination.trim());
    if !valid_profile_name(name) {
        return Err(DesktopFailure::invalid_input());
    }
    validate_export_destination(destination)?;
    let (hermes, storage, home) = runtime_paths(&state).await?;
    let staging_root = storage.join("profile-exports");
    fs::create_dir_all(filesystem_path(&staging_root))
        .map_err(|_| DesktopFailure::operation_failed())?;
    let staging_metadata = fs::symlink_metadata(filesystem_path(&staging_root))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !staging_metadata.is_dir() || staging_metadata.file_type().is_symlink() {
        return Err(DesktopFailure::operation_failed());
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DesktopFailure::operation_failed())?
        .as_nanos();
    let staging = staging_root.join(format!("{name}-{}-{nonce}.tar.gz", std::process::id()));
    let _ = append_client_event(&storage, &format!("profile_export_start profile={name}"));
    let mut command =
        helper_python::command(&hermes, EXPORT_SCRIPT).map_err(DesktopFailure::from)?;
    command
        .arg(name)
        .arg(plain_path(&staging))
        .env("HERMES_HOME", plain_path(&home))
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = timeout(
        Duration::from_secs(120),
        process_manager::output(&mut command, "profile_export"),
    )
    .await;
    let output = match output {
        Err(_) => {
            let _ = fs::remove_file(filesystem_path(&staging));
            let _ = append_client_event(
                &storage,
                &format!("profile_export_failed profile={name} reason=timeout"),
            );
            return Err(DesktopFailure::timeout());
        }
        Ok(Err(_)) => {
            let _ = fs::remove_file(filesystem_path(&staging));
            let _ = append_client_event(
                &storage,
                &format!("profile_export_failed profile={name} reason=process"),
            );
            return Err(DesktopFailure::operation_failed());
        }
        Ok(Ok(output)) if !output.status.success() => {
            let _ = fs::remove_file(filesystem_path(&staging));
            let _ = append_client_event(
                &storage,
                &format!("profile_export_failed profile={name} reason=exit_status"),
            );
            return Err(DesktopFailure::operation_failed());
        }
        Ok(Ok(output)) => output,
    };
    let result: Value = match serde_json::from_slice(&output.stdout) {
        Ok(result) => result,
        Err(_) => {
            let _ = fs::remove_file(filesystem_path(&staging));
            return Err(DesktopFailure::operation_failed());
        }
    };
    let Some(archive) = result.get("archive").and_then(Value::as_str).map(Path::new) else {
        let _ = fs::remove_file(filesystem_path(&staging));
        return Err(DesktopFailure::operation_failed());
    };
    let Some(bytes) = result.get("bytes").and_then(Value::as_u64) else {
        let _ = fs::remove_file(filesystem_path(&staging));
        return Err(DesktopFailure::operation_failed());
    };
    let archive_metadata = fs::symlink_metadata(filesystem_path(archive))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if plain_path(archive) != plain_path(&staging)
        || !archive_metadata.is_file()
        || archive_metadata.file_type().is_symlink()
    {
        let _ = fs::remove_file(filesystem_path(&staging));
        return Err(DesktopFailure::operation_failed());
    }
    let copied = copy_new(&staging, destination);
    let _ = fs::remove_file(filesystem_path(&staging));
    let copied = copied?;
    if copied != bytes {
        let _ = fs::remove_file(filesystem_path(destination));
        return Err(DesktopFailure::operation_failed());
    }
    let _ = append_client_event(
        &storage,
        &format!("profile_export_completed profile={name} bytes={bytes}"),
    );
    Ok(json!({"archive": plain_path(destination), "bytes": bytes}))
}

#[tauri::command]
pub async fn import_profile_archive(
    state: State<'_, BackendState>,
    archive: String,
    name: Option<String>,
) -> Result<Value, DesktopFailure> {
    let archive = Path::new(archive.trim());
    validate_import_archive(archive)?;
    let name = name
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if name
        .as_deref()
        .is_some_and(|value| !valid_profile_name(value) || value == "default")
    {
        return Err(DesktopFailure::invalid_input());
    }
    let (hermes, storage, home) = runtime_paths(&state).await?;
    let label = name.as_deref().unwrap_or("inferred");
    let _ = append_client_event(
        &storage,
        &format!("profile_import_start requested_profile={label}"),
    );
    let mut command =
        helper_python::command(&hermes, IMPORT_SCRIPT).map_err(DesktopFailure::from)?;
    command
        .arg(plain_path(archive))
        .arg(serde_json::to_string(&name).map_err(|_| DesktopFailure::invalid_input())?)
        .env("HERMES_HOME", plain_path(&home))
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = timeout(
        Duration::from_secs(120),
        process_manager::output(&mut command, "profile_import"),
    )
    .await;
    let output = match output {
        Err(_) => {
            let _ = append_client_event(
                &storage,
                &format!("profile_import_failed requested_profile={label} reason=timeout"),
            );
            return Err(DesktopFailure::timeout());
        }
        Ok(Err(_)) => {
            let _ = append_client_event(
                &storage,
                &format!("profile_import_failed requested_profile={label} reason=process"),
            );
            return Err(DesktopFailure::operation_failed());
        }
        Ok(Ok(output)) if !output.status.success() => {
            let _ = append_client_event(
                &storage,
                &format!("profile_import_failed requested_profile={label} reason=exit_status"),
            );
            return Err(DesktopFailure::operation_failed());
        }
        Ok(Ok(output)) => output,
    };
    let mut result: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| DesktopFailure::operation_failed())?;
    let imported = result
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| valid_profile_name(value) && *value != "default")
        .ok_or_else(DesktopFailure::operation_failed)?
        .to_owned();
    let mut warnings = Vec::new();
    if super::product_skill::install_new_profile(&home, &imported).is_err() {
        warnings.push(Value::String("product_skill".into()));
        let _ = append_client_event(
            &storage,
            &format!("profile_import_product_skill_failed profile={imported}"),
        );
    }
    #[cfg(windows)]
    if super::powershell_tool::install_new_profile(&home, &imported).is_err() {
        warnings.push(Value::String("powershell_tool".into()));
        let _ = append_client_event(
            &storage,
            &format!("profile_import_powershell_tool_failed profile={imported}"),
        );
    }
    result["warnings"] = Value::Array(warnings);
    let _ = append_client_event(
        &storage,
        &format!("profile_import_completed profile={imported}"),
    );
    Ok(result)
}

#[cfg(test)]
#[path = "tests/profile_archive.rs"]
mod tests;
