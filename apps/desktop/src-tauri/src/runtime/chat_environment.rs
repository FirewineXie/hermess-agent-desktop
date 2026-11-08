//! Per-session executable discovery. Never mutate the Gateway process environment.
use super::helper_python;
use crate::{errors::DesktopFailure, paths::plain_path, process_manager};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::Path, process::Stdio, time::Duration};

const PREPARE: &str = include_str!("../../../runtime/chat_environment.py");

#[derive(Deserialize)]
struct Prepared {
    client_env: Value,
    managed_path_count: usize,
}

pub(super) async fn prepare(
    hermes: &Path,
    storage: &Path,
) -> Result<(Value, usize), DesktopFailure> {
    let home = plain_path(&storage.join("hermes-home"));
    let mut roots = vec![home.join("tools")];
    let payload = hermes
        .parent()
        .and_then(Path::parent)
        .filter(|root| root.join("manifest.json").is_file())
        .map(plain_path)
        .or_else(|| {
            if !cfg!(debug_assertions) {
                return None;
            }
            let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.build/payload");
            root.join("manifest.json")
                .is_file()
                .then(|| plain_path(&root))
        });
    if let Some(payload) = payload {
        roots.push(payload.join("tools"));
    }
    let mut command = helper_python::command(hermes, PREPARE)?;
    command
        .env("HERMES_HOME", &home)
        .env(
            "HERMESS_CHAT_TOOL_ROOTS",
            serde_json::to_string(&roots).map_err(|_| DesktopFailure::operation_failed())?,
        )
        .env_remove("HERMES_RUNTIME_DIR")
        .env_remove("HERMES_INSTALL_ROOT")
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env_remove("VIRTUAL_ENV")
        .env_remove("CONDA_PREFIX")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let (child, registration) = process_manager::spawn(&mut command, "chat_tool_environment")
        .map_err(|_| DesktopFailure::operation_failed())?;
    let result = tokio::time::timeout(Duration::from_secs(15), child.wait_with_output()).await;
    registration
        .terminate_tree()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let output = result
        .map_err(|_| DesktopFailure::timeout())?
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !output.status.success() || output.stdout.len() > 64 * 1024 {
        return Err(DesktopFailure::operation_failed());
    }
    let prepared: Prepared =
        serde_json::from_slice(&output.stdout).map_err(|_| DesktopFailure::operation_failed())?;
    let path = prepared
        .client_env
        .get("PATH")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::operation_failed)?;
    // Only this field crosses the session.create boundary, even if the helper grows.
    Ok((json!({"PATH": path}), prepared.managed_path_count))
}

#[cfg(all(test, windows))]
#[path = "tests/chat_environment.rs"]
mod tests;
