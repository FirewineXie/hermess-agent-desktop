use super::{
    helper_python, hermes_process_path, profile_scope::ResolvedProfileScope, BackendState,
};
use crate::{diagnostics::append_client_event, errors::DesktopFailure, process_manager};
use serde_json::Value;
use std::{process::Stdio, time::Duration};
use tauri::State;
use uuid::Uuid;

pub(super) const SCRIPT: &str = include_str!("vault_keys.py");

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let action = match operation {
        "vault.key.status" => "status",
        "vault.key.migrate" => payload["target"]
            .as_str()
            .filter(|target| matches!(*target, "keychain" | "file"))
            .ok_or_else(DesktopFailure::invalid_input)?,
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let operation_id = Uuid::new_v4();
    let log = |phase| {
        let _ = append_client_event(
            &scope.storage,
            &format!(
                "vault_key operation={operation_id} profile={} action={action} phase={phase}",
                scope.profile
            ),
        );
    };
    log("start");
    let result = async {
        scope.ensure_current(state).await?;
        let home = scope.owned_home()?;
        let mut command =
            helper_python::command(&scope.hermes, SCRIPT).map_err(DesktopFailure::from)?;
        command
            .arg(action)
            .env("HERMES_HOME", hermes_process_path(&home))
            .env_remove("PYTHON_KEYRING_BACKEND")
            .env("HERMES_DISABLE_LAZY_INSTALLS", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let output = tokio::time::timeout(
            Duration::from_secs(90),
            process_manager::output(&mut command, "vault_key"),
        )
        .await
        .map_err(|_| DesktopFailure::timeout())?
        .map_err(|_| DesktopFailure::operation_failed())?;
        let result: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| DesktopFailure::operation_failed())?;
        if !output.status.success() {
            if result["error"] == "keychain_unavailable" {
                return Err(DesktopFailure::from("系统钥匙串当前不可用"));
            }
            return Err(DesktopFailure::operation_failed());
        }
        scope.ensure_current(state).await?;
        Ok(result)
    }
    .await;
    log(if result.is_ok() {
        "completed"
    } else {
        "failed"
    });
    result
}
