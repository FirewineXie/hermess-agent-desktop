//! Shared, bounded shutdown of profile-local services through registered plugin CLIs.
use super::{helper_python, location, BackendState};
use crate::{
    diagnostics::append_client_event,
    paths::{filesystem_path, plain_path},
    process_manager,
};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, fs, path::PathBuf, process::Stdio, time::Duration};
use tauri::{AppHandle, Manager};
use tokio::{io::AsyncReadExt, time::timeout};
use uuid::Uuid;

const BRIDGE: &str = include_str!("../../../runtime/plugin_services.py");
const OUTPUT_LIMIT: u64 = 256 * 1024;
const RECORD_LIMIT: u64 = 1024 * 1024;
const CLEANUP_BUDGET: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
struct Target {
    profile: String,
    service: String,
}

#[derive(Deserialize, Serialize)]
struct Pending {
    schema: u32,
    targets: BTreeSet<Target>,
}

pub(crate) struct Cleanup {
    hermes: PathBuf,
    storage: PathBuf,
    // Retain storage ownership after stop_backend drops OwnedBackend.
    _owner: fs::File,
    operation: Uuid,
}

impl Cleanup {
    /// Snapshot before stopping the backend; never discover a runtime by port.
    pub(crate) async fn capture(
        app: &AppHandle,
        state: &BackendState,
    ) -> Result<Option<Self>, &'static str> {
        state.6.cancel();
        let owned = state.0.lock().await;
        let (hermes, storage, owner) = if let Some(backend) = owned.as_ref() {
            (
                backend.hermes.clone(),
                backend.storage.clone(),
                backend
                    ._storage_lock
                    .try_clone()
                    .map_err(|_| "owner_clone")?,
            )
        } else {
            let Some(storage) = super::existing_client_log_storage(app) else {
                return Ok(None);
            };
            let owner = location::acquire_storage_lock(&storage).map_err(|_| "owner_lock")?;
            let hermes = if cfg!(debug_assertions) {
                let defaults = super::dev_backend_defaults().map_err(|_| "runtime_defaults")?;
                PathBuf::from(defaults.python_path).with_file_name(if cfg!(windows) {
                    "hermes.exe"
                } else {
                    "hermes"
                })
            } else {
                let resources = app.path().resource_dir().map_err(|_| "runtime_resources")?;
                super::payload::validate_payload(&plain_path(&resources).join("runtime/payload"))
                    .map_err(|_| "runtime_invalid")?
            };
            (hermes, storage, owner)
        };
        Ok(Some(Self {
            hermes: plain_path(&hermes),
            storage: plain_path(&storage),
            _owner: owner,
            operation: Uuid::new_v4(),
        }))
    }

    fn log(&self, target: Option<&Target>, stage: &str, outcome: &str) {
        let (profile, service) = target
            .map(|target| (target.profile.as_str(), target.service.as_str()))
            .unwrap_or(("all", "all"));
        let level = if matches!(
            outcome,
            "started" | "completed" | "stopped" | "ready" | "starting"
        ) {
            ""
        } else {
            "ERROR "
        };
        let _ = append_client_event(
            &self.storage,
            &format!(
                "{level}plugin_service_cleanup operation={} profile={profile} service={service} stage={stage} outcome={outcome}",
                self.operation
            ),
        );
    }

    fn record_path(&self) -> PathBuf {
        self.storage.join("control/plugin-service-cleanup.json")
    }

    fn pending(&self) -> Result<BTreeSet<Target>, &'static str> {
        let path = filesystem_path(&self.record_path());
        let metadata = match fs::metadata(&path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeSet::new());
            }
            Err(_) => return Err("record_read"),
        };
        if metadata.len() > RECORD_LIMIT {
            return Err("record_limit");
        }
        let pending: Pending = serde_json::from_slice(&fs::read(path).map_err(|_| "record_read")?)
            .map_err(|_| "record_invalid")?;
        if pending.schema != 1 || pending.targets.iter().any(|target| !valid_target(target)) {
            return Err("record_invalid");
        }
        Ok(pending.targets)
    }

    fn save_pending(&self, targets: &BTreeSet<Target>) -> Result<(), &'static str> {
        let bytes = serde_json::to_vec(&Pending {
            schema: 1,
            targets: targets.clone(),
        })
        .map_err(|_| "record_encode")?;
        let path = self.record_path();
        let temporary =
            path.with_file_name(format!("plugin-service-cleanup-{}.tmp", self.operation));
        fs::write(filesystem_path(&temporary), bytes).map_err(|_| "record_write")?;
        if fs::rename(filesystem_path(&temporary), filesystem_path(&path)).is_err() {
            let _ = fs::remove_file(filesystem_path(&temporary));
            return Err("record_replace");
        }
        Ok(())
    }

    async fn command(&self, action: &str, target: Option<&Target>) -> Result<Value, &'static str> {
        let home = self.storage.join("hermes-home");
        let mut command =
            helper_python::command(&self.hermes, BRIDGE).map_err(|_| "runtime_missing")?;
        command
            .arg(&home)
            .arg(action)
            .env("HERMES_HOME", &home)
            .env("HERMES_DISABLE_LAZY_INSTALLS", "1")
            .env_remove("HERMES_PROFILE")
            .env_remove("HERMES_PROFILE_NAME")
            .env_remove("HERMES_ENABLE_PROJECT_PLUGINS")
            .current_dir(&home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Some(target) = target {
            command.arg(&target.profile).arg(&target.service);
        }
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let (mut child, registration) =
            process_manager::spawn_shutdown(&mut command, "plugin_service_cleanup")
                .map_err(|_| "command_spawn")?;
        let stdout = child.stdout.take().ok_or("command_stdout")?;
        let budget = if action == "stop" { 10 } else { 5 };
        let result = timeout(Duration::from_secs(budget), async {
            let mut bytes = Vec::new();
            stdout
                .take(OUTPUT_LIMIT + 1)
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| "command_read")?;
            if bytes.len() as u64 > OUTPUT_LIMIT {
                return Err("output_limit");
            }
            let status = child.wait().await.map_err(|_| "command_wait")?;
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| "command_protocol")?;
            if !status.success() || value.get("ok").and_then(Value::as_bool) != Some(true) {
                // Only our fixed error vocabulary may reach logs.
                return Err(match value.get("error").and_then(Value::as_str) {
                    Some("command_unavailable") => "command_unavailable",
                    Some("profile_missing") => "profile_missing",
                    Some("configuration_missing") => "configuration_missing",
                    Some("outside_product_home") => "outside_product_home",
                    Some("unrecognized_status") => "unrecognized_status",
                    _ => "command_failed",
                });
            }
            Ok(value)
        })
        .await
        .unwrap_or(Err("command_timeout"));
        if result.is_err() {
            if registration.terminate_tree().await.is_err() {
                self.log(target, "command_reap", "reap_failed");
            }
            let _ = timeout(Duration::from_secs(2), child.wait()).await;
        }
        result
    }

    async fn stop_target(&self, target: &Target) -> Result<(), &'static str> {
        self.log(Some(target), "probe", "started");
        let value = self.command("status", Some(target)).await?;
        match value.get("state").and_then(Value::as_str) {
            Some("stopped") => return Ok(()),
            Some("ready" | "starting") => {}
            _ => return Err("unrecognized_status"),
        }
        self.log(Some(target), "stop", "started");
        self.command("stop", Some(target)).await?;
        self.log(Some(target), "verify", "started");
        let verified = self.command("status", Some(target)).await?;
        if verified.get("state").and_then(Value::as_str) != Some("stopped") {
            return Err("service_still_running");
        }
        Ok(())
    }

    pub(crate) async fn run(&self) -> bool {
        self.log(None, "inventory", "started");
        let result = self.run_inner().await;
        self.log(None, "finish", result.err().unwrap_or("completed"));
        result.is_ok()
    }

    async fn run_inner(&self) -> Result<(), &'static str> {
        let mut pending = self.pending()?;
        let inventory = self.command("inventory", None).await?;
        let targets: Vec<Target> = serde_json::from_value(
            inventory
                .get("targets")
                .cloned()
                .ok_or("inventory_invalid")?,
        )
        .map_err(|_| "inventory_invalid")?;
        if targets.iter().any(|target| !valid_target(target)) {
            return Err("inventory_invalid");
        }
        pending.extend(targets);
        self.save_pending(&pending)?;
        let completed = timeout(CLEANUP_BUDGET, async {
            let mut work = stream::iter(pending.iter().cloned().map(|target| async move {
                let result = self.stop_target(&target).await;
                self.log(Some(&target), "finish", result.err().unwrap_or("stopped"));
                (target, result.is_ok())
            }))
            .buffer_unordered(2);
            let mut remaining = pending.clone();
            while let Some((target, success)) = work.next().await {
                if success {
                    remaining.remove(&target);
                    // Checkpoint each success: a later timeout must keep only unresolved entries.
                    self.save_pending(&remaining)?;
                }
            }
            Ok::<_, &'static str>(remaining.is_empty())
        })
        .await
        .map_err(|_| "cleanup_timeout")??;
        if completed {
            Ok(())
        } else {
            Err("cleanup_incomplete")
        }
    }
}

fn valid_target(target: &Target) -> bool {
    super::profile_scope::valid_profile_name(&target.profile)
        && !target.service.is_empty()
        && target.service.len() <= 100
        && target
            .service
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-_".contains(&byte))
}

#[cfg(test)]
#[path = "tests/plugin_services.rs"]
mod tests;
