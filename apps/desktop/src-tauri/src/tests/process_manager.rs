use super::{ProcessManager, ProcessState};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

#[cfg(windows)]
#[test]
fn shutdown_blocks_new_processes_and_closes_registered_tree() {
    use std::{os::windows::process::CommandExt, process::Command};

    let manager = Arc::new(ProcessManager {
        state: Mutex::new(ProcessState::default()),
        platform: test_platform(),
    });
    let (mut child, registration) = manager
        .launch(
            "test_child",
            false,
            || {
                let child = Command::new("cmd.exe")
                    .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
                    .creation_flags(0x0800_0000)
                    .spawn()?;
                let pid = child.id();
                Ok((child, pid))
            },
            |child| {
                let _ = child.kill();
            },
        )
        .unwrap();

    manager.begin_shutdown();
    assert!(manager
        .launch(
            "late_child",
            false,
            || -> std::io::Result<((), u32)> { panic!("shutdown must reject before spawning") },
            |_| {}
        )
        .is_err());
    assert_eq!(manager.kill_remaining(), vec![("test_child", child.id())]);
    for _ in 0..30 {
        if child.try_wait().unwrap().is_some() {
            drop(registration);
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    panic!("registered process survived shutdown");
}

#[cfg(windows)]
#[test]
fn managed_grandchild_fixture() {
    use std::os::windows::process::CommandExt;
    let Ok(path) = std::env::var("HERMESS_TREE_TEST_PID_FILE") else {
        return;
    };
    let mut grandchild = std::process::Command::new("cmd.exe")
        .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
        .creation_flags(0x0800_0000)
        .spawn()
        .unwrap();
    std::fs::write(path, grandchild.id().to_string()).unwrap();
    let _ = grandchild.wait();
}

#[cfg(windows)]
#[test]
fn shutdown_closes_descendants_of_a_registered_process() {
    use std::os::windows::io::{AsRawHandle, FromRawHandle};
    use std::{os::windows::process::CommandExt, process::Command};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

    let manager = Arc::new(ProcessManager {
        state: Mutex::new(ProcessState::default()),
        platform: test_platform(),
    });
    let pid_file = std::env::temp_dir().join(format!("hermess-tree-{}.pid", uuid::Uuid::new_v4()));
    let (mut parent, _registration) = manager
        .launch(
            "test_tree",
            false,
            || {
                let child = Command::new(std::env::current_exe()?)
                    .args([
                        "--exact",
                        "process_manager::tests::managed_grandchild_fixture",
                    ])
                    .env("HERMESS_TREE_TEST_PID_FILE", &pid_file)
                    .creation_flags(0x0800_0000)
                    .spawn()?;
                let pid = child.id();
                Ok((child, pid))
            },
            |child| {
                let _ = child.kill();
            },
        )
        .unwrap();
    let grandchild_pid = (0..100)
        .find_map(|_| {
            if let Ok(pid) = std::fs::read_to_string(&pid_file) {
                return pid.parse::<u32>().ok();
            }
            std::thread::sleep(Duration::from_millis(50));
            None
        })
        .expect("fixture did not start its grandchild");
    let grandchild = unsafe { OpenProcess(0x0010_0000, 0, grandchild_pid) };
    assert!(!grandchild.is_null());
    let grandchild = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(grandchild) };
    manager.begin_shutdown();
    manager.kill_remaining();
    assert!(parent.wait().is_ok());
    assert_eq!(
        unsafe { WaitForSingleObject(grandchild.as_raw_handle(), 3000) },
        0
    );
    std::fs::remove_file(pid_file).unwrap();
}

#[cfg(windows)]
#[test]
fn exited_process_is_removed_without_another_api_call() {
    use std::{os::windows::process::CommandExt, process::Command};
    let manager = Arc::new(ProcessManager {
        state: Mutex::new(ProcessState::default()),
        platform: test_platform(),
    });
    let (mut child, registration) = manager
        .launch(
            "short_task",
            false,
            || {
                let child = Command::new("cmd.exe")
                    .args(["/C", "exit 0"])
                    .creation_flags(0x0800_0000)
                    .spawn()?;
                let pid = child.id();
                Ok((child, pid))
            },
            |child| {
                let _ = child.kill();
            },
        )
        .unwrap();
    assert!(child.wait().unwrap().success());
    for _ in 0..30 {
        if manager.state.lock().unwrap().entries.is_empty() {
            drop(registration);
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    drop(registration);
    panic!("finished process was not removed from the registry");
}

#[cfg(windows)]
#[test]
fn exiting_gateway_fixture() {
    use std::os::windows::process::CommandExt;
    let Ok(directory) = std::env::var("HERMESS_EXITING_GATEWAY_FIXTURE") else {
        return;
    };
    let directory = std::path::PathBuf::from(directory);
    // Wait until the parent has assigned this process to the managed Job.
    for _ in 0..200 {
        if directory.join("registered").exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(directory.join("registered").exists());
    let child = std::process::Command::new("cmd.exe")
        .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
        .creation_flags(0x0800_0000)
        .spawn()
        .unwrap();
    std::fs::write(directory.join("child.pid"), child.id().to_string()).unwrap();
    for _ in 0..200 {
        if directory.join("exit").exists() {
            // Like an AI's restart helper, this descendant is still alive when
            // the original Gateway exits; the manager must reclaim it.
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    panic!("fixture did not receive its exit signal");
}

#[cfg(windows)]
#[test]
fn natural_gateway_exit_reclaims_its_restart_descendant() {
    use std::os::windows::io::{AsRawHandle, FromRawHandle};
    use std::{os::windows::process::CommandExt, process::Command};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

    let manager = Arc::new(ProcessManager {
        state: Mutex::new(ProcessState::default()),
        platform: test_platform(),
    });
    let directory =
        std::env::temp_dir().join(format!("hermess-exit-tree-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let (mut parent, registration) = manager
        .launch(
            "gateway",
            false,
            || {
                let child = Command::new(std::env::current_exe()?)
                    .args(["--exact", "process_manager::tests::exiting_gateway_fixture"])
                    .env("HERMESS_EXITING_GATEWAY_FIXTURE", &directory)
                    .creation_flags(0x0800_0000)
                    .spawn()?;
                let pid = child.id();
                Ok((child, pid))
            },
            |child| {
                let _ = child.kill();
            },
        )
        .unwrap();
    std::fs::write(directory.join("registered"), b"").unwrap();
    let child_pid = (0..200)
        .find_map(|_| {
            let pid = std::fs::read_to_string(directory.join("child.pid"))
                .ok()
                .and_then(|value| value.parse::<u32>().ok());
            if pid.is_none() {
                std::thread::sleep(Duration::from_millis(25));
            }
            pid
        })
        .expect("fixture did not create its descendant");
    let child = unsafe { OpenProcess(0x0010_0000, 0, child_pid) };
    assert!(!child.is_null());
    let child = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(child) };
    assert_eq!(
        unsafe { WaitForSingleObject(child.as_raw_handle(), 0) },
        258
    );
    std::fs::write(directory.join("exit"), b"").unwrap();
    assert!(parent.wait().unwrap().success());
    // Keep the registration alive: cleanup must happen on root exit, without
    // waiting for another API call or an explicit desktop stop.
    assert_eq!(
        unsafe { WaitForSingleObject(child.as_raw_handle(), 5000) },
        0
    );
    assert!(manager.state.lock().unwrap().entries.is_empty());
    drop(registration);
    std::fs::remove_dir_all(directory).unwrap();
}

#[cfg(not(windows))]
#[test]
fn shutdown_rejects_new_launches() {
    let manager = Arc::new(ProcessManager {
        state: Mutex::new(ProcessState::default()),
        platform: test_platform(),
    });
    manager.begin_shutdown();
    assert!(manager
        .launch(
            "late_child",
            false,
            || -> std::io::Result<((), u32)> { panic!("shutdown must reject before spawning") },
            |_| {}
        )
        .is_err());
}

#[cfg(windows)]
#[tokio::test]
async fn terminating_one_registration_preserves_other_processes() {
    use std::{os::windows::process::CommandExt, process::Command};
    async fn wait_for_exit(child: &mut std::process::Child) {
        tokio::time::timeout(Duration::from_secs(3), async {
            while child.try_wait().unwrap().is_none() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("terminated process reaches its exit state");
    }
    let manager = Arc::new(ProcessManager {
        state: Mutex::new(ProcessState::default()),
        platform: test_platform(),
    });
    let launch = || {
        manager
            .launch(
                "isolated_test_child",
                false,
                || {
                    let child = Command::new("cmd.exe")
                        .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
                        .creation_flags(0x0800_0000)
                        .spawn()?;
                    let pid = child.id();
                    Ok((child, pid))
                },
                |child| {
                    let _ = child.kill();
                },
            )
            .unwrap()
    };
    let (mut target, target_registration) = launch();
    let (mut other, other_registration) = launch();
    target_registration.terminate_tree().await.unwrap();
    wait_for_exit(&mut target).await;
    assert!(other.try_wait().unwrap().is_none());
    assert!(manager
        .state
        .lock()
        .unwrap()
        .entries
        .contains_key(&other_registration.id));
    // Repeated cleanup is harmless, including after the watcher removed it.
    target_registration.terminate_tree().await.unwrap();
    other_registration.terminate_tree().await.unwrap();
    wait_for_exit(&mut other).await;
    assert!(manager.state.lock().unwrap().entries.is_empty());
}

#[cfg(target_os = "macos")]
fn test_platform() -> super::platform::PlatformManager {
    super::platform::PlatformManager::for_test()
}

#[cfg(not(target_os = "macos"))]
fn test_platform() -> super::platform::PlatformManager {
    super::platform::PlatformManager::new().unwrap()
}

#[cfg(target_os = "macos")]
#[test]
fn shutdown_closes_mac_process_group_and_descendant() {
    use std::{
        io::BufRead,
        os::unix::process::CommandExt,
        process::{Command, Stdio},
    };
    let manager = Arc::new(ProcessManager {
        state: Mutex::new(ProcessState::default()),
        platform: test_platform(),
    });
    let (mut child, _registration) = manager
        .launch(
            "test_tree",
            false,
            || {
                let child = Command::new("/bin/sh")
                    .args(["-c", "sleep 30 & echo $!; wait"])
                    .stdout(Stdio::piped())
                    .process_group(0)
                    .spawn()?;
                let pid = child.id();
                Ok((child, pid))
            },
            |child| {
                let _ = child.kill();
            },
        )
        .unwrap();
    let mut line = String::new();
    std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let grandchild = line.trim().parse::<i32>().unwrap();
    assert_eq!(unsafe { libc::getpgid(grandchild) }, child.id() as i32);
    manager.begin_shutdown();
    manager.kill_remaining();
    child.wait().unwrap();
    for _ in 0..30 {
        if unsafe { libc::kill(grandchild, 0) } == -1 {
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ESRCH)
            );
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("macOS process-group descendant survived shutdown");
}
