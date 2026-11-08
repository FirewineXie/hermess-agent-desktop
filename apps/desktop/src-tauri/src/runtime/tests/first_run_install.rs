use super::{ensure, needed, save, RECORD};
use std::{fs, path::PathBuf};

fn storage() -> PathBuf {
    let root = std::env::temp_dir()
        .join(format!("hermess-first-run-{}", uuid::Uuid::new_v4()))
        .join("HermessAgentDesktop");
    fs::create_dir_all(root.join("control")).unwrap();
    root
}

#[test]
fn new_root_retries_pending_but_preserves_existing_users_and_completed_installs() {
    let root = storage();
    assert!(needed(&root).unwrap());
    save(&root, false).unwrap();
    fs::create_dir_all(root.join("hermes-home")).unwrap();
    assert!(
        needed(&root).unwrap(),
        "a failed first attempt remains retryable"
    );
    save(&root, true).unwrap();
    assert!(!needed(&root).unwrap(), "restart never reinstalls");
    fs::remove_file(root.join("control").join(RECORD)).unwrap();
    assert!(
        !needed(&root).unwrap(),
        "existing users are not initialized again"
    );
    fs::write(root.join("control").join(RECORD), b"broken").unwrap();
    assert!(
        needed(&root).is_err(),
        "invalid receipts must not trigger an install"
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn failed_install_keeps_pending_and_can_be_retried() {
    let root = storage();
    assert!(ensure(&root.join("missing-launcher"), &root).await.is_err());
    fs::create_dir_all(root.join("hermes-home")).unwrap();
    assert!(needed(&root).unwrap());
    assert!(ensure(&root.join("missing-launcher"), &root).await.is_err());
    assert!(needed(&root).unwrap());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "runs a real default PM install in an isolated data root; requires HERMESS_FIRST_RUN_TEST_HERMES"]
async fn pinned_pm_first_install_live() {
    use crate::process_manager::ProcessManager;
    let hermes = PathBuf::from(std::env::var_os("HERMESS_FIRST_RUN_TEST_HERMES").unwrap());
    assert!(hermes.is_absolute());
    let root = storage();
    let _manager = ProcessManager::init().unwrap();
    eprintln!("isolated first-run test storage: {}", root.display());
    ensure(&hermes, &root)
        .await
        .expect("real pinned PM install");
    assert!(!needed(&root).unwrap());
    let before = fs::read(root.join("logs/first-run-install.log")).unwrap();
    // Once complete, even a missing launcher must not run PM again.
    ensure(&root.join("missing-launcher"), &root).await.unwrap();
    assert_eq!(
        before,
        fs::read(root.join("logs/first-run-install.log")).unwrap()
    );
    #[cfg(windows)]
    {
        use crate::runtime::{gateway_recovery, BackendState};
        use tauri::Manager;
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context.config_mut().identifier = format!(
            "com.hermess.first-run-test-{}",
            uuid::Uuid::new_v4().simple()
        );
        let app = tauri::Builder::default()
            .any_thread()
            .build(context)
            .unwrap();
        struct Cleanup(std::sync::Arc<ProcessManager>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                self.0.kill_remaining();
            }
        }
        let _cleanup = Cleanup(_manager);
        app.manage(BackendState::default());
        let info = gateway_recovery::start(
            app.handle().clone(),
            &app.state(),
            hermes,
            root.parent().unwrap().to_path_buf(),
            true,
        )
        .await
        .expect("actual Gateway starts after the completed PM install");
        assert!(info.pid > 0 && info.port > 0);
        assert_eq!(
            before,
            fs::read(root.join("logs/first-run-install.log")).unwrap()
        );
    }
}
