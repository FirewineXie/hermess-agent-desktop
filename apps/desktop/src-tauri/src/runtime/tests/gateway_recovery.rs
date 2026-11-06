use super::{reserve_restart, RecoveryState, RESTART_WINDOW};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::time::{timeout, Instant};

#[test]
fn automatic_recovery_allows_one_new_process_per_window() {
    let now = Instant::now();
    let mut last_restart = None;
    assert!(reserve_restart(&mut last_restart, now));
    assert!(!reserve_restart(
        &mut last_restart,
        now + Duration::from_secs(1)
    ));
    assert!(!reserve_restart(
        &mut last_restart,
        now + RESTART_WINDOW - Duration::from_millis(1)
    ));
    assert!(reserve_restart(&mut last_restart, now + RESTART_WINDOW));
}

#[tokio::test]
async fn stop_cancels_active_and_queued_recovery_before_taking_the_gate() {
    let state = RecoveryState::default();
    state.enabled.store(true, Ordering::Release);
    let active = state.gate.lock().await;
    let mut active_cancel = state.subscribe();
    let queued_cancel = state.subscribe();
    state.cancel();
    timeout(Duration::from_millis(100), active_cancel.changed())
        .await
        .unwrap()
        .unwrap();
    assert!(!state.enabled.load(Ordering::Acquire));
    drop(active);
    let _queued = state.gate.lock().await;
    assert!(queued_cancel.has_changed().unwrap());
}

#[tokio::test]
async fn recovery_queue_deadline_returns_without_claiming_the_gate() {
    let state = RecoveryState::default();
    let active = state.gate.lock().await;
    let mut cancellation = state.subscribe();
    let result = timeout(
        Duration::from_secs(1),
        state.recovery_gate(
            &mut cancellation,
            Instant::now() + Duration::from_millis(20),
            uuid::Uuid::new_v4(),
        ),
    )
    .await
    .expect("queued recovery observes its own deadline");
    let error = result.err().expect("busy lifecycle gate timed out");
    assert_eq!(serde_json::to_value(error).unwrap()["code"], "timeout");
    drop(active);
    assert!(
        state.gate.try_lock().is_ok(),
        "timed-out request left the lock queue"
    );
    assert!(state.last_restart.lock().await.is_none());
}

#[tokio::test]
async fn stop_cancels_queued_recovery_without_waiting_for_active_operation() {
    let state = RecoveryState::default();
    let _active = state.gate.lock().await;
    let mut cancellation = state.subscribe();
    let waiting = state.recovery_gate(
        &mut cancellation,
        Instant::now() + RESTART_WINDOW,
        uuid::Uuid::new_v4(),
    );
    let stop = async {
        tokio::task::yield_now().await;
        state.cancel();
    };
    let (result, _) = timeout(Duration::from_secs(1), async {
        tokio::join!(waiting, stop)
    })
    .await
    .expect("stop cancels a request still waiting for the lifecycle gate");
    let error = result.err().expect("queued recovery was cancelled");
    assert_eq!(
        serde_json::to_value(error).unwrap()["code"],
        "runtime_unavailable"
    );
    assert!(state.last_restart.lock().await.is_none());
}

#[tokio::test]
async fn gateway_switch_interrupts_recovery_without_disabling_local_runtime() {
    let state = RecoveryState::default();
    state.enabled.store(true, Ordering::Release);
    let mut cancellation = state.subscribe();
    state.interrupt();
    cancellation.changed().await.unwrap();
    assert!(state.enabled.load(Ordering::Acquire));
    assert!(!state.subscribe().has_changed().unwrap());
}

#[tokio::test]
async fn manual_retry_can_reset_exhausted_budget() {
    let state = RecoveryState::default();
    let now = Instant::now();
    assert!(reserve_restart(&mut *state.last_restart.lock().await, now));
    assert!(!reserve_restart(&mut *state.last_restart.lock().await, now));
    state.last_restart.lock().await.take();
    assert!(reserve_restart(&mut *state.last_restart.lock().await, now));
}

#[cfg(windows)]
struct SuspendedGatewayThreads(Vec<windows_sys::Win32::Foundation::HANDLE>);

#[cfg(windows)]
impl SuspendedGatewayThreads {
    fn pause(pid: u32) -> Self {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
            System::{
                Diagnostics::ToolHelp::{
                    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD,
                    THREADENTRY32,
                },
                Threading::{OpenThread, SuspendThread, THREAD_SUSPEND_RESUME},
            },
        };
        let mut paused = Self(Vec::new());
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        assert_ne!(snapshot, INVALID_HANDLE_VALUE);
        let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut found = unsafe { Thread32First(snapshot, &mut entry) } != 0;
        while found {
            if entry.th32OwnerProcessID == pid {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if !thread.is_null() {
                    if unsafe { SuspendThread(thread) } != u32::MAX {
                        paused.0.push(thread);
                    } else {
                        unsafe { CloseHandle(thread) };
                    }
                }
            }
            found = unsafe { Thread32Next(snapshot, &mut entry) } != 0;
        }
        unsafe { CloseHandle(snapshot) };
        assert!(
            !paused.0.is_empty(),
            "paused the isolated Gateway's threads"
        );
        paused
    }
}

#[cfg(windows)]
impl Drop for SuspendedGatewayThreads {
    fn drop(&mut self) {
        use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::ResumeThread};
        for thread in self.0.drain(..) {
            unsafe {
                ResumeThread(thread);
                CloseHandle(thread);
            }
        }
    }
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "requires isolated Gateway configuration and verify-gateway-recovery.py driver"]
async fn gateway_recovery_live() {
    use super::{start, BackendState};
    use crate::process_manager::ProcessManager;
    use crate::runtime::{
        browser_bridge::BrowserBridgeState, channel_whatsapp::WhatsAppSetupState,
    };
    use std::{fs, path::PathBuf};
    use tauri::Manager;

    let hermes =
        PathBuf::from(std::env::var_os("HERMESS_TEST_GATEWAY_HERMES").expect("isolated launcher"));
    let storage =
        PathBuf::from(std::env::var_os("HERMESS_TEST_GATEWAY_STORAGE").expect("isolated storage"));
    let sync = PathBuf::from(
        std::env::var_os("HERMESS_TEST_GATEWAY_SYNC").expect("driver synchronization directory"),
    );
    assert!(hermes.is_absolute() && storage.is_absolute() && sync.is_absolute());
    fs::create_dir_all(&sync).unwrap();
    let processes = ProcessManager::init().unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = format!(
        "com.hermess.recovery-test-{}",
        uuid::Uuid::new_v4().simple()
    );
    let app = tauri::Builder::default()
        .any_thread()
        .build(context)
        .expect("windowless Tauri test app");
    struct ProcessCleanup(std::sync::Arc<ProcessManager>);
    impl Drop for ProcessCleanup {
        fn drop(&mut self) {
            self.0.kill_remaining();
        }
    }
    // Drop before the App even when an assertion unwinds, so a failed live
    // probe cannot leave the owned Gateway holding its windows/pipe resources.
    let _cleanup = ProcessCleanup(processes);
    app.manage(BackendState::default());
    app.manage(BrowserBridgeState::default());
    app.manage(WhatsAppSetupState::default());
    let mut info = start(
        app.handle().clone(),
        &app.state(),
        hermes.clone(),
        storage.parent().unwrap().to_path_buf(),
        true,
    )
    .await
    .expect("production Gateway startup");
    // Recover a closed transport without replacing the still-owned child.
    app.state::<BackendState>()
        .0
        .lock()
        .await
        .as_ref()
        .unwrap()
        .gateway
        .close();
    let same_process = crate::runtime::reconnect_backend(app.handle().clone(), app.state(), None)
        .await
        .expect("production same-process reconnect");
    assert_eq!(info.pid, same_process.pid);
    info = same_process;
    let healthy_connection = app
        .state::<BackendState>()
        .0
        .lock()
        .await
        .as_ref()
        .unwrap()
        .gateway
        .clone();
    let healthy = crate::runtime::reconnect_backend(app.handle().clone(), app.state(), None)
        .await
        .expect("healthy connection remains reusable");
    assert_eq!(healthy.pid, info.pid);
    assert!(std::sync::Arc::ptr_eq(
        &healthy_connection,
        &app.state::<BackendState>()
            .0
            .lock()
            .await
            .as_ref()
            .unwrap()
            .gateway
    ));
    // The ownership-checked PID comes from this temporary Gateway's lock, never
    // from a port scan or another installation. Pause only the isolated fixture.
    let gateway_pid = || -> u32 {
        let lock: serde_json::Value =
            serde_json::from_slice(&fs::read(storage.join("hermes-home/gateway.lock")).unwrap())
                .unwrap();
        u32::try_from(lock["pid"].as_u64().unwrap()).unwrap()
    };
    let paused = SuspendedGatewayThreads::pause(gateway_pid());
    let reconnect = crate::runtime::reconnect_backend(app.handle().clone(), app.state(), None);
    let resume = async {
        tokio::time::sleep(Duration::from_millis(400)).await;
        drop(paused);
    };
    let (transient, _) = tokio::join!(reconnect, resume);
    assert_eq!(
        transient
            .expect("brief transport outage recovers without restart")
            .pid,
        info.pid
    );
    for stage in 0..3 {
        fs::write(
            sync.join(format!("ready-{stage}.json")),
            serde_json::json!({"pid":info.pid,"port":info.port}).to_string(),
        )
        .unwrap();
        if stage < 2 {
            let state = app.state::<BackendState>();
            let status = timeout(Duration::from_secs(90), async {
                loop {
                    assert!(
                        !sync.join("finish").exists(),
                        "driver aborted before expected exit"
                    );
                    if let Some(status) = state
                        .0
                        .lock()
                        .await
                        .as_mut()
                        .unwrap()
                        .child
                        .try_wait()
                        .unwrap()
                    {
                        break status;
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            })
            .await
            .expect("driver requests a bounded Gateway exit");
            assert_eq!(status.code(), Some(if stage == 0 { 0 } else { 75 }));
            assert!(crate::runtime::ping_backend(app.state()).await.is_err());
            let previous_pid = info.pid;
            info = crate::runtime::reconnect_backend(
                app.handle().clone(),
                app.state(),
                Some(stage == 1),
            )
            .await
            .expect("production exited-process recovery");
            assert_ne!(info.pid, previous_pid);
        } else {
            timeout(Duration::from_secs(90), async {
                while !sync.join("finish").exists() {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            })
            .await
            .expect("driver completed restored-session checks");
        }
    }
    let paused = SuspendedGatewayThreads::pause(gateway_pid());
    let before_recovery = Instant::now();
    let replaced = crate::runtime::reconnect_backend(app.handle().clone(), app.state(), Some(true))
        .await
        .expect("one call replaces the unresponsive but live owned Gateway");
    assert!(before_recovery.elapsed() >= super::RECONNECT_GRACE);
    assert_ne!(replaced.pid, info.pid);
    assert_ne!(replaced.replay_epoch, info.replay_epoch);
    drop(paused);
    crate::runtime::stop_backend(app.state(), app.state(), app.state())
        .await
        .expect("intentional stop");
    assert!(
        crate::runtime::reconnect_backend(app.handle().clone(), app.state(), Some(true))
            .await
            .is_err()
    );
    assert!(app.state::<BackendState>().0.lock().await.is_none());
    // Exercise the production cancellation path, including a child being spawned:
    // stop announces its intent before waiting for the shared lifecycle gate.
    let state = app.state::<BackendState>();
    let start_again = start(
        app.handle().clone(),
        &state,
        hermes,
        storage.parent().unwrap().to_path_buf(),
        true,
    );
    let cancel_start = async {
        while !state.6.enabled.load(Ordering::Acquire) {
            tokio::task::yield_now().await;
        }
        crate::runtime::stop_backend(app.state(), app.state(), app.state()).await
    };
    let (started, stopped) = timeout(Duration::from_secs(10), async {
        tokio::join!(start_again, cancel_start)
    })
    .await
    .expect("intentional stop cancels production startup promptly");
    assert!(started.is_err());
    stopped.expect("stop completes after cancelling startup");
    assert!(state.0.lock().await.is_none());
    assert!(
        crate::runtime::reconnect_backend(app.handle().clone(), app.state(), Some(true))
            .await
            .is_err()
    );
}
