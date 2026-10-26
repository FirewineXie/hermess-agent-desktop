//! The desktop registers each product-owned process tree for orderly shutdown.
use std::{
    collections::HashMap,
    io,
    process::{ExitStatus, Output, Stdio},
    sync::{Arc, Mutex, OnceLock},
};
use tokio::process::{Child, Command};
use uuid::Uuid;

#[cfg(windows)]
#[path = "process_manager/windows.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "process_manager/macos.rs"]
mod platform;
#[cfg(all(not(windows), not(target_os = "macos")))]
#[path = "process_manager/other.rs"]
mod platform;

static MANAGER: OnceLock<Arc<ProcessManager>> = OnceLock::new();

pub struct ProcessManager {
    state: Mutex<ProcessState>,
    platform: platform::PlatformManager,
}

#[derive(Default)]
struct ProcessState {
    shutting_down: bool,
    entries: HashMap<Uuid, ProcessEntry>,
}

struct ProcessEntry {
    kind: &'static str,
    pid: u32,
    tree: platform::ProcessTree,
}

pub struct ProcessRegistration {
    id: Uuid,
    manager: Arc<ProcessManager>,
}

impl Drop for ProcessRegistration {
    fn drop(&mut self) {
        if let Ok(mut state) = self.manager.state.lock() {
            state.entries.remove(&self.id);
        }
    }
}

impl ProcessManager {
    pub fn init() -> io::Result<Arc<Self>> {
        let manager = Arc::new(Self {
            state: Mutex::new(ProcessState::default()),
            platform: platform::PlatformManager::new()?,
        });
        MANAGER
            .set(manager.clone())
            .map_err(|_| io::Error::other("进程管理器重复初始化"))?;
        Ok(manager)
    }

    pub fn current() -> io::Result<Arc<Self>> {
        MANAGER
            .get()
            .cloned()
            .ok_or_else(|| io::Error::other("进程管理器尚未初始化"))
    }

    pub fn launch<T>(
        self: &Arc<Self>,
        kind: &'static str,
        allow_shutdown: bool,
        launch: impl FnOnce() -> io::Result<(T, u32)>,
        _stop_on_failure: impl FnOnce(&mut T),
    ) -> io::Result<(T, ProcessRegistration)> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("进程管理器状态不可用"))?;
        if state.shutting_down && !allow_shutdown {
            return Err(io::Error::other("桌面程序正在退出，不能启动新进程"));
        }
        let mut tree = platform::ProcessTree::new(&self.platform)?;
        let (mut child, pid) = launch()?;
        if let Err(error) = tree.assign(pid) {
            _stop_on_failure(&mut child);
            return Err(error);
        }
        let id = Uuid::new_v4();
        state.entries.insert(id, ProcessEntry { kind, pid, tree });
        let manager = Arc::downgrade(self);
        if let Err(error) = platform::watch_exit(pid, kind, move || {
            if let Some(manager) = manager.upgrade() {
                if let Ok(mut state) = manager.state.lock() {
                    state.entries.remove(&id);
                }
            }
        }) {
            state.entries.remove(&id);
            _stop_on_failure(&mut child);
            return Err(error);
        }
        Ok((
            child,
            ProcessRegistration {
                id,
                manager: self.clone(),
            },
        ))
    }

    pub fn begin_shutdown(&self) -> bool {
        if let Ok(mut state) = self.state.lock() {
            if state.shutting_down {
                return false;
            }
            state.shutting_down = true;
            return true;
        }
        false
    }

    fn take_entries(&self, include: impl Fn(&ProcessEntry) -> bool) -> Vec<ProcessEntry> {
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        let ids: Vec<_> = state
            .entries
            .iter()
            .filter_map(|(id, entry)| include(entry).then_some(*id))
            .collect();
        ids.into_iter()
            .filter_map(|id| state.entries.remove(&id))
            .collect()
    }

    fn terminate_entries(&self, entries: Vec<ProcessEntry>) -> Vec<(&'static str, u32)> {
        let mut entries = entries;
        let remaining = entries
            .iter()
            .map(|entry| (entry.kind, entry.pid))
            .collect();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        for entry in &mut entries {
            if !entry.tree.terminate_and_wait(deadline) {
                eprintln!(
                    "Desktop process tree did not exit within shutdown budget: {} {}",
                    entry.kind, entry.pid
                );
            }
        }
        drop(entries);
        remaining
    }

    pub fn kill_temporary(&self) -> Vec<(&'static str, u32)> {
        self.terminate_entries(
            self.take_entries(|entry| entry.kind != "gateway" && entry.kind != "gateway_stop"),
        )
    }

    pub fn kill_remaining(&self) -> Vec<(&'static str, u32)> {
        self.terminate_entries(self.take_entries(|_| true))
    }
}

fn spawn_inner(
    command: &mut Command,
    kind: &'static str,
    allow_shutdown: bool,
) -> io::Result<(Child, ProcessRegistration)> {
    let manager = ProcessManager::current()?;
    platform::configure_command(command);
    manager.launch(
        kind,
        allow_shutdown,
        || {
            let mut child = command.spawn()?;
            let Some(pid) = child.id() else {
                let _ = child.start_kill();
                return Err(io::Error::other("子进程没有 PID"));
            };
            Ok((child, pid))
        },
        |child| {
            let _ = child.start_kill();
        },
    )
}

pub fn spawn(
    command: &mut Command,
    kind: &'static str,
) -> io::Result<(Child, ProcessRegistration)> {
    spawn_inner(command, kind, false)
}

pub fn spawn_shutdown(
    command: &mut Command,
    kind: &'static str,
) -> io::Result<(Child, ProcessRegistration)> {
    spawn_inner(command, kind, true)
}

pub async fn output(command: &mut Command, kind: &'static str) -> io::Result<Output> {
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let (child, _registration) = spawn(command, kind)?;
    child.wait_with_output().await
}

pub async fn status(command: &mut Command, kind: &'static str) -> io::Result<ExitStatus> {
    command.kill_on_drop(true);
    let (mut child, _registration) = spawn(command, kind)?;
    child.wait().await
}

#[cfg(all(windows, test))]
pub use platform::ProcessJob;

#[cfg(all(test, windows))]
pub fn process_job_for_test() -> io::Result<ProcessJob> {
    ProcessJob::new(&platform::PlatformManager::new()?)
}

#[cfg(target_os = "macos")]
pub use platform::maybe_run_watchdog;

#[cfg(test)]
#[path = "tests/process_manager.rs"]
mod tests;
