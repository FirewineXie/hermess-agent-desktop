use super::location::{read_storage_location, write_storage_location};
use super::models::{
    custom_endpoint_delete_path, parse_saved_model_config, read_model_lists_file,
    write_model_lists_file,
};
use super::payload::validate_payload;
use super::{acquire_storage_lock, install_packed_payload, running_storage_matches};
use super::{
    dev_backend_defaults, BackendInfo, BundledTool, BundledToolsInventory, GracefulRestartResult,
    PackedDefaults,
};
use crate::diagnostics::{
    append_client_event, daily_log_files, newest_log_entries_first, read_diagnostic_logs,
};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::process::Command;
use uuid::Uuid;

#[test]
fn backend_info_serializes_contract_fields() {
    let actual = serde_json::to_value(BackendInfo {
        port: 1421,
        pid: 421,
        replay_epoch: "fixture-epoch".to_owned(),
    })
    .unwrap();
    assert_eq!(
        actual,
        json!({"port": 1421, "pid": 421, "replay_epoch": "fixture-epoch"})
    );
}

#[test]
fn graceful_restart_reports_restarted_or_deferred() {
    assert_eq!(
        serde_json::to_value(GracefulRestartResult::Deferred).unwrap(),
        json!({"status": "deferred"})
    );
    assert_eq!(
        serde_json::to_value(GracefulRestartResult::Restarted {
            info: BackendInfo {
                port: 1421,
                pid: 421,
                replay_epoch: "next-epoch".to_owned(),
            },
        })
        .unwrap(),
        json!({"status": "restarted", "info": {
            "port": 1421, "pid": 421, "replay_epoch": "next-epoch"
        }})
    );
}

#[test]
fn runtime_defaults_and_tool_inventory_serialize_contract_fields() {
    let dev = dev_backend_defaults().unwrap();
    let build = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
        .join(".build");
    assert_eq!(
        dev.storage_path,
        build.join("desktop-dev-data").to_string_lossy()
    );
    let python = if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    };
    assert_eq!(
        dev.python_path,
        build.join("hermes-venv-i1").join(python).to_string_lossy()
    );
    assert_eq!(
        serde_json::to_value(PackedDefaults {
            storage_path: "example-data".into(),
            initialized: true,
        })
        .unwrap(),
        json!({"storage_path": "example-data", "initialized": true})
    );
    assert_eq!(
        serde_json::to_value(BundledToolsInventory {
            has_manifest: true,
            tools: vec![BundledTool {
                name: "python".into(),
                version: "3.14".into(),
                path: "example-data/runtime/tools/python".into(),
                present: true,
            }],
        })
        .unwrap(),
        json!({"has_manifest": true, "tools": [{
            "name": "python", "version": "3.14",
            "path": "example-data/runtime/tools/python", "present": true
        }]})
    );
}

#[test]
fn model_lists_survive_a_second_read() {
    let root = std::env::temp_dir().join(format!("hermess-model-lists-{}", Uuid::new_v4()));
    fs::create_dir_all(root.join("HermessAgentDesktop")).unwrap();
    let file = root
        .join("HermessAgentDesktop")
        .join("model-candidates.json");
    assert!(read_model_lists_file(&file).unwrap().is_none());
    let lists = HashMap::from([(
        "ark-provider".to_string(),
        vec!["ark-code-latest".to_string()],
    )]);
    write_model_lists_file(&file, &lists).unwrap();
    assert_eq!(read_model_lists_file(&file).unwrap(), Some(lists));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn custom_endpoint_delete_path_has_one_separator_before_id() {
    assert_eq!(
        custom_endpoint_delete_path("desktop-example").unwrap(),
        "/api/providers/custom-endpoints/desktop-example"
    );
}

#[test]
fn running_backend_rejects_a_different_storage_location() {
    let root = std::env::temp_dir().join(format!("hermess-storage-match-{}", Uuid::new_v4()));
    let first = root.join("first");
    let second = root.join("second");
    fs::create_dir_all(first.join("HermessAgentDesktop")).unwrap();
    fs::create_dir_all(&second).unwrap();
    let running = first.join("HermessAgentDesktop").canonicalize().unwrap();
    assert!(running_storage_matches(&running, &first));
    assert!(!running_storage_matches(&running, &second));
    assert!(!running_storage_matches(&running, &root.join("missing")));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn diagnostic_entries_show_newest_first_without_reversing_stack_traces() {
    let content = "2026-10-24 23:22:15 INFO first\n  first detail\n2026-10-24 23:22:16 ERROR second\n  second detail";
    assert_eq!(
            newest_log_entries_first(content),
            "2026-10-24 23:22:16 ERROR second\n  second detail\n2026-10-24 23:22:15 INFO first\n  first detail"
        );
}

#[test]
fn saved_model_config_returns_only_public_model_fields() {
    let yaml = "model:\n  provider: custom\n  default: ark-code-latest\n  base_url: https://ark.cn-beijing.volces.com/api/coding/v3\n  api_key: secret-example\n";
    let config = parse_saved_model_config(yaml).unwrap();
    assert_eq!(config.provider, "custom");
    assert_eq!(config.model, "ark-code-latest");
    assert_eq!(
        config.base_url,
        "https://ark.cn-beijing.volces.com/api/coding/v3"
    );
    assert_eq!(
        serde_json::to_value(&config).unwrap(),
        json!({
            "provider": "custom",
            "model": "ark-code-latest",
            "base_url": "https://ark.cn-beijing.volces.com/api/coding/v3"
        })
    );
    assert!(!serde_json::to_string(&config)
        .unwrap()
        .contains("secret-example"));
}

#[test]
fn storage_lock_child() {
    let Ok(path) = std::env::var("HERMESS_TEST_STORAGE_LOCK_PATH") else {
        return;
    };
    let acquired = acquire_storage_lock(std::path::Path::new(&path)).is_ok();
    let expected = std::env::var("HERMESS_TEST_STORAGE_LOCK_AVAILABLE").unwrap_or_default() == "1";
    assert_eq!(acquired, expected);
}

fn check_child_lock(root: &std::path::Path, available: bool) {
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "runtime::tests::storage_lock_child"])
        .env("HERMESS_TEST_STORAGE_LOCK_PATH", root)
        .env(
            "HERMESS_TEST_STORAGE_LOCK_AVAILABLE",
            if available { "1" } else { "0" },
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "child lock check failed: {}",
        String::from_utf8_lossy(&output.stdout)
    );
}

#[test]
fn storage_lock_rejects_second_owner_and_recovers_after_release() {
    let root = std::env::temp_dir().join(format!("hermess-storage-lock-{}", Uuid::new_v4()));
    fs::create_dir_all(root.join("control")).unwrap();
    let first = acquire_storage_lock(&root).unwrap();
    assert!(acquire_storage_lock(&root).is_err());
    check_child_lock(&root, false);
    drop(first);
    let second = acquire_storage_lock(&root).unwrap();
    drop(second);
    check_child_lock(&root, true);
    fs::remove_file(root.join("control").join("owner.lock")).unwrap();
    fs::remove_dir(root.join("control")).unwrap();
    fs::remove_dir(root).unwrap();
}

#[cfg(all(windows, target_arch = "x86_64"))]
#[test]
fn packed_payload_rejects_a_different_upstream_commit() {
    let root = std::env::temp_dir().join(format!("hermess-payload-check-{}", Uuid::new_v4()));
    fs::create_dir_all(root.join("bin")).unwrap();
    fs::write(root.join("bin/hermes.exe"), b"test launcher").unwrap();
    let lock: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../runtime/upstream.lock.json"
    )))
    .unwrap();
    let mut manifest = serde_json::json!({
        "schema": 1, "target": "win32-x64", "repo": "hermes-agent",
        "ref": lock["commit"], "runtime": {"commands": {"hermes": "bin/hermes.exe"}}
    });
    fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
    assert!(validate_payload(&root).is_ok());
    manifest["ref"] = serde_json::json!("different-upstream-commit");
    fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
    assert!(validate_payload(&root).is_err());
    fs::remove_file(root.join("manifest.json")).unwrap();
    fs::remove_file(root.join("bin/hermes.exe")).unwrap();
    fs::remove_dir(root.join("bin")).unwrap();
    fs::remove_dir(root).unwrap();
}

#[cfg(all(windows, target_arch = "x86_64"))]
#[test]
#[ignore = "requires a prepared 1.6 GB offline runtime archive under .build/runtime"]
fn packed_payload_installs_from_real_archive() {
    let product = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let build = product.join(".build");
    let selected = build.join("installed-runtime-smoke");
    let launcher = install_packed_payload(&build, &selected).unwrap();
    assert!(launcher.is_file());
    assert_eq!(install_packed_payload(&build, &selected).unwrap(), launcher);
}

#[test]
fn storage_location_survives_restart_and_refuses_corruption() {
    let root = std::env::temp_dir().join(format!("hermess-location-{}", Uuid::new_v4()));
    let file = root.join("config/location.json");
    assert!(read_storage_location(&file).unwrap().is_none());
    let selected = root.join("中文 空格 存储");
    write_storage_location(&file, &selected).unwrap();
    assert_eq!(read_storage_location(&file).unwrap(), Some(selected));
    fs::write(&file, b"{broken").unwrap();
    assert!(read_storage_location(&file).is_err());
    fs::remove_file(file).unwrap();
    fs::remove_dir(root.join("config")).unwrap();
    fs::remove_dir(root).unwrap();
}

#[test]
fn client_events_use_daily_files_and_diagnostics_keep_sources_separate() {
    let selected = std::env::temp_dir().join(format!("hermess-logs-{}", Uuid::new_v4()));
    let storage = selected.join("HermessAgentDesktop");
    fs::create_dir_all(&storage).unwrap();
    append_client_event(&storage, "backend_starting").unwrap();
    append_client_event(&storage, "backend_started").unwrap();
    let files = daily_log_files(&storage, "client-").unwrap();
    assert_eq!(files.len(), 1);
    assert!(files[0]
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("client-"));
    let client_logs =
        read_diagnostic_logs(selected.to_string_lossy().into_owned(), "client".into()).unwrap();
    assert!(
        client_logs.find("backend_started").unwrap()
            < client_logs.find("backend_starting").unwrap()
    );
    assert!(
        !read_diagnostic_logs(selected.to_string_lossy().into_owned(), "hermes".into())
            .unwrap()
            .contains("backend_starting")
    );
    fs::remove_dir_all(selected).unwrap();
}
