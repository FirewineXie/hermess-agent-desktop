use super::command;
use crate::process_manager;
use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{process::Command, time::sleep};
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires HERMESS_TEST_PAYLOAD_ROOT set to a relocated, extracted payload"]
async fn packed_helper_imports_from_relocated_payload() {
    let root = PathBuf::from(
        std::env::var_os("HERMESS_TEST_PAYLOAD_ROOT")
            .expect("set HERMESS_TEST_PAYLOAD_ROOT to an extracted payload outside .build"),
    )
    .canonicalize()
    .expect("payload root exists");
    assert!(root.join("manifest.json").is_file());
    let build = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.build")
        .canonicalize()
        .expect("build directory exists");
    assert!(!root.starts_with(build));
    let launcher = root.join("bin").join(if cfg!(windows) {
        "hermes.exe"
    } else {
        "hermes"
    });
    let mut helper = command(
        &launcher,
        "import json,psutil,hermes_cli,subprocess,sys; child=subprocess.run([sys.executable,'-c','import hermes_cli,psutil'],capture_output=True); print(json.dumps({'ready':True,'child_ok':child.returncode==0}))",
    )
    .expect("resolve bundled helper Python");
    let output = helper.output().await.expect("run bundled helper Python");
    assert!(
        output.status.success(),
        "bundled helper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).expect("helper JSON");
    assert_eq!(result["ready"], true);
    assert_eq!(result["child_ok"], true);
}

#[tokio::test]
#[ignore = "requires HERMESS_TEST_PAYLOAD_ROOT set to a relocated, extracted payload"]
async fn packed_helper_discovers_and_mints_ticket_for_owned_gateway() {
    let root = PathBuf::from(
        std::env::var_os("HERMESS_TEST_PAYLOAD_ROOT")
            .expect("set HERMESS_TEST_PAYLOAD_ROOT to a relocated payload"),
    )
    .canonicalize()
    .expect("payload root exists");
    let launcher = root.join("bin").join(if cfg!(windows) {
        "hermes.exe"
    } else {
        "hermes"
    });
    let scratch = std::env::temp_dir().join(format!("hermess-helper-smoke-{}", Uuid::new_v4()));
    let home = scratch.join("hermes-home");
    fs::create_dir_all(&home).unwrap();
    #[cfg(windows)]
    let home = home.canonicalize().unwrap();
    let manager = process_manager::ProcessManager::init().unwrap();
    let mut launch = Command::new(&launcher);
    launch
        .args(["gateway", "run"])
        .env("HERMES_HOME", &home)
        .env("HERMES_GATEWAY_LOCK_DIR", scratch.join("gateway-locks"))
        .env("HERMES_DESKTOP", "1")
        .env("HERMESS_DESKTOP_PRIVATE_API", "1")
        .env(
            "HERMES_DASHBOARD_SESSION_TOKEN",
            Uuid::new_v4().simple().to_string(),
        )
        .env("HERMES_PARENT_PID", std::process::id().to_string())
        .env("HERMES_DISABLE_LAZY_INSTALLS", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    launch.creation_flags(0x0800_0000);
    let (mut child, registration) = process_manager::spawn(&mut launch, "gateway").unwrap();
    let pid = child.id().unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    let found = loop {
        if child.try_wait().unwrap().is_some() {
            break Err("gateway exited before ready".to_owned());
        }
        if home.join("gateway.lock").is_file() {
            match super::super::discover_owned_gateway(&home, pid).await {
                Ok(Some(found)) => break Ok(found),
                Ok(None) => {}
                Err(error) => break Err(error),
            }
        }
        if Instant::now() >= deadline {
            break Err("gateway did not become ready".to_owned());
        }
        sleep(Duration::from_millis(200)).await;
    };
    let result = match found {
        Ok((_, endpoint)) => {
            assert!(super::super::discover_owned_gateway(&home, u32::MAX)
                .await
                .unwrap()
                .is_none());
            assert!(
                super::super::mint_gateway_ticket(&home, &endpoint, u32::MAX)
                    .await
                    .is_err()
            );
            super::super::mint_gateway_ticket(&home, &endpoint, pid)
                .await
                .map(|ticket| !ticket.is_empty())
        }
        Err(error) => Err(error),
    };
    manager.kill_remaining();
    let _ = child.wait().await;
    drop(registration);
    let _ = fs::remove_dir_all(&scratch);
    assert_eq!(result.unwrap(), true);
}
