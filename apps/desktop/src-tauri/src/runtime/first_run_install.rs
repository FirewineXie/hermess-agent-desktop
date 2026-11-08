//! One default PM install for a new product data root, before its first Gateway.
use super::{helper_python, hermes_process_path};
use crate::diagnostics::append_client_event;
use crate::errors::DesktopFailure;
use crate::paths::filesystem_path;
use crate::process_manager;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, process::Stdio, time::Duration};
use tokio::{process::Command, time::timeout};
use uuid::Uuid;

const RECORD: &str = "first-run-install.json";

// A bare PM install tolerates failed optional defaults. Verify its actual closure
// before calling this new-user installation complete; never install GPU variants.
const VERIFY_INSTALL: &str = r#"
import json
from pm.defaults import default_packages
from pm.install import enabled_extras, is_installed
from pm.lock import Lockfile
from pm.paths import lockfile_path
from pm.registry import tool_roots
names = Lockfile(lockfile_path()).names()
expected = sorted(set(tool_roots(names) + default_packages(names)))
missing = [name for name in expected if not is_installed(name)]
if 'all' not in enabled_extras():
    missing.append('venv:all')
print(json.dumps({'missing': missing}), flush=True)
raise SystemExit(1 if missing else 0)
"#;

#[derive(Deserialize, Serialize)]
struct Record {
    schema: u8,
    completed: bool,
}

fn needed(storage: &Path) -> Result<bool, DesktopFailure> {
    match fs::read(filesystem_path(&storage.join("control").join(RECORD))) {
        Ok(bytes) => {
            let record: Record =
                serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
            if record.schema != 1 {
                return Err(DesktopFailure::operation_failed());
            }
            Ok(!record.completed)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Existing users predate this receipt. Never install over their selection.
            Ok(!filesystem_path(&storage.join("hermes-home")).exists())
        }
        Err(_) => Err(DesktopFailure::operation_failed()),
    }
}

fn save(storage: &Path, completed: bool) -> Result<(), DesktopFailure> {
    let control = storage.join("control");
    let temporary = control.join(format!("first-run-install-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec(&Record {
        schema: 1,
        completed,
    })
    .map_err(|_| DesktopFailure::operation_failed())?;
    fs::write(filesystem_path(&temporary), bytes)
        .map_err(|_| DesktopFailure::operation_failed())?;
    if fs::rename(
        filesystem_path(&temporary),
        filesystem_path(&control.join(RECORD)),
    )
    .is_err()
    {
        let _ = fs::remove_file(filesystem_path(&temporary));
        return Err(DesktopFailure::operation_failed());
    }
    Ok(())
}

struct Operation<'a> {
    storage: &'a Path,
    id: Uuid,
    finished: bool,
}

impl Operation<'_> {
    fn log(&self, outcome: &str) {
        let _ = append_client_event(
            self.storage,
            &format!("first_run_install_{outcome} operation={}", self.id),
        );
    }
}

impl Drop for Operation<'_> {
    fn drop(&mut self) {
        if !self.finished {
            self.log("cancelled");
        }
    }
}

// Caller holds the product storage lock and the Gateway lifecycle gate.
pub(super) async fn ensure(hermes: &Path, storage: &Path) -> Result<(), DesktopFailure> {
    if !needed(storage).inspect_err(|_| {
        let _ = append_client_event(storage, "ERROR first_run_install_record_failed");
    })? {
        return Ok(());
    }
    let mut operation = Operation {
        storage,
        id: Uuid::new_v4(),
        finished: false,
    };
    operation.log("start");
    let mut stage = "prepare";
    let result = async {
        // Persist pending before PM creates HERMES_HOME, so failures remain retryable.
        save(storage, false)?;
        let logs = storage.join("logs");
        fs::create_dir_all(filesystem_path(&logs))
            .map_err(|_| DesktopFailure::operation_failed())?;
        let log = fs::File::create(filesystem_path(&logs.join("first-run-install.log")))
            .map_err(|_| DesktopFailure::operation_failed())?;
        let stderr = log
            .try_clone()
            .map_err(|_| DesktopFailure::operation_failed())?;
        let mut command = Command::new(hermes);
        command
            .args(["pm", "install"])
            .env(
                "HERMES_HOME",
                hermes_process_path(&storage.join("hermes-home")),
            )
            .env("HERMES_DISABLE_LAZY_INSTALLS", "0")
            .env_remove("HERMES_PROFILE")
            .env_remove("HERMES_PROFILE_NAME")
            .env_remove("HERMES_RUNTIME_DIR")
            .env_remove("HERMES_INSTALL_ROOT")
            .current_dir(storage)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(stderr))
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        stage = "install";
        let status = timeout(
            Duration::from_secs(1800),
            process_manager::status(&mut command, "first_run_install"),
        )
        .await
        .map_err(|_| DesktopFailure::timeout())?
        .map_err(|_| DesktopFailure::operation_failed())?;
        if !status.success() {
            return Err(DesktopFailure::operation_failed());
        }
        stage = "verify";
        operation.log("verifying");
        let log = fs::OpenOptions::new()
            .append(true)
            .open(filesystem_path(&logs.join("first-run-install.log")))
            .map_err(|_| DesktopFailure::operation_failed())?;
        let stderr = log
            .try_clone()
            .map_err(|_| DesktopFailure::operation_failed())?;
        let mut verify = helper_python::command(hermes, VERIFY_INSTALL)?;
        verify
            .env(
                "HERMES_HOME",
                hermes_process_path(&storage.join("hermes-home")),
            )
            .env_remove("HERMES_PROFILE")
            .env_remove("HERMES_PROFILE_NAME")
            .env_remove("HERMES_RUNTIME_DIR")
            .env_remove("HERMES_INSTALL_ROOT")
            .current_dir(storage)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(stderr));
        #[cfg(windows)]
        verify.creation_flags(0x0800_0000);
        let status = timeout(
            Duration::from_secs(30),
            process_manager::status(&mut verify, "first_run_verify"),
        )
        .await
        .map_err(|_| DesktopFailure::timeout())?
        .map_err(|_| DesktopFailure::operation_failed())?;
        if !status.success() {
            return Err(DesktopFailure::operation_failed());
        }
        stage = "record";
        save(storage, true)
    }
    .await;
    match &result {
        Ok(()) => operation.log("completed"),
        Err(error) => {
            let _ = append_client_event(
                storage,
                &format!(
                    "ERROR first_run_install_failed operation={} stage={stage} error={}",
                    operation.id,
                    serde_json::to_string(error).unwrap_or_default()
                ),
            );
        }
    }
    operation.finished = true;
    result
}

#[cfg(test)]
#[path = "tests/first_run_install.rs"]
mod tests;
