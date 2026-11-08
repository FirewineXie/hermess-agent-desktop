use super::{valid_target, Cleanup, Target};
use std::{collections::BTreeSet, fs};

fn target(profile: &str) -> Target {
    Target {
        profile: profile.into(),
        service: "openviking.quick-local".into(),
    }
}

#[test]
fn cleanup_record_retains_unresolved_profiles_and_rejects_invalid_records() {
    let root = std::env::temp_dir().join(format!("hermess-services-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("control")).unwrap();
    let cleanup = Cleanup {
        hermes: root.join("hermes"),
        storage: root.clone(),
        _owner: fs::File::create(root.join("owner.lock")).unwrap(),
        operation: uuid::Uuid::new_v4(),
    };
    let targets = BTreeSet::from([target("default"), target("work")]);
    cleanup.save_pending(&targets).unwrap();
    assert_eq!(cleanup.pending().unwrap(), targets);
    let remaining = BTreeSet::from([target("work")]);
    cleanup.save_pending(&remaining).unwrap();
    assert_eq!(cleanup.pending().unwrap(), remaining);
    cleanup.save_pending(&BTreeSet::new()).unwrap();
    assert!(cleanup.pending().unwrap().is_empty());
    fs::write(cleanup.record_path(), br#"{"schema":2,"targets":[]}"#).unwrap();
    assert_eq!(cleanup.pending().unwrap_err(), "record_invalid");
    assert!(!valid_target(&target("../another-install")));
    assert!(!valid_target(&Target {
        service: "openviking\nsecret".into(),
        ..target("work")
    }));
    drop(cleanup);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn snapshot_lock_keeps_storage_owned_after_backend_handle_closes() {
    let root = std::env::temp_dir().join(format!("hermess-service-lock-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("control")).unwrap();
    let backend_lock = super::location::acquire_storage_lock(&root).unwrap();
    let cleanup_lock = backend_lock.try_clone().unwrap();
    drop(backend_lock);
    assert!(super::location::acquire_storage_lock(&root).is_err());
    drop(cleanup_lock);
    assert!(super::location::acquire_storage_lock(&root).is_ok());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "requires isolated profiles and pinned OpenViking CLI; driven by verify-plugin-services.py"]
async fn plugin_services_live() {
    use crate::process_manager::ProcessManager;
    use std::path::PathBuf;

    let hermes = PathBuf::from(std::env::var_os("HERMESS_SERVICE_TEST_HERMES").unwrap());
    let storage = PathBuf::from(std::env::var_os("HERMESS_SERVICE_TEST_STORAGE").unwrap());
    let processes = ProcessManager::init().unwrap();
    struct Guard(std::sync::Arc<ProcessManager>);
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.kill_remaining();
        }
    }
    let _guard = Guard(processes.clone());
    let cleanup = Cleanup {
        hermes,
        _owner: super::location::acquire_storage_lock(&storage).unwrap(),
        storage,
        operation: uuid::Uuid::new_v4(),
    };
    // Cleanup commands must remain allowed after ordinary launch is closed.
    processes.begin_shutdown();
    let inventory = cleanup.command("inventory", None).await.unwrap();
    let targets: BTreeSet<Target> = serde_json::from_value(inventory["targets"].clone()).unwrap();
    assert_eq!(targets, BTreeSet::from([target("default"), target("work")]));
    for profile in ["default", "work"] {
        let state = cleanup
            .command("status", Some(&target(profile)))
            .await
            .unwrap();
        assert!(matches!(
            state["state"].as_str(),
            Some("ready" | "starting")
        ));
    }
    assert!(cleanup.run().await);
    assert!(cleanup.pending().unwrap().is_empty());
    for profile in ["default", "work"] {
        let state = cleanup
            .command("status", Some(&target(profile)))
            .await
            .unwrap();
        assert_eq!(state["state"], "stopped");
    }
    // A removed CLI must remain unresolved, never silently pass as stopped.
    fs::rename(
        cleanup
            .storage
            .join("hermes-home/profiles/work/plugins/openviking/cli.py"),
        cleanup
            .storage
            .join("hermes-home/profiles/work/plugins/openviking/cli.removed"),
    )
    .unwrap();
    assert!(!cleanup.run().await);
    assert_eq!(cleanup.pending().unwrap(), BTreeSet::from([target("work")]));
    // A hung CLI is terminated through the production command wrapper.
    fs::write(
        cleanup
            .storage
            .join("hermes-home/plugins/openviking/cli.py"),
        "import time\ntime.sleep(60)\n",
    )
    .unwrap();
    assert_eq!(
        cleanup
            .command("status", Some(&target("default")))
            .await
            .unwrap_err(),
        "command_timeout"
    );
    assert!(processes.kill_remaining().is_empty());
}
