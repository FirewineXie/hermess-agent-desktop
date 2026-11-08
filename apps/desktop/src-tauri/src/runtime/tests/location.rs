use super::*;
use crate::paths::CanonicalizePlain;

#[test]
fn programming_root_is_beside_hermes_home_before_gateway_initialization() {
    let temporary = tempfile::tempdir().unwrap();
    let selected = temporary
        .path()
        .canonicalize_plain()
        .unwrap()
        .join("not-created-yet");
    let root = programming_root_at(&selected).unwrap();
    assert_eq!(root, selected.join("HermessAgentDesktop/programming"));
    assert!(!filesystem_path(&selected).exists());
    fs::create_dir_all(filesystem_path(&root)).unwrap();
    fs::create_dir_all(filesystem_path(&root.with_file_name("hermes-home"))).unwrap();
    assert_eq!(
        crate::storage::product_storage(&selected).unwrap(),
        root.parent().unwrap()
    );
}

#[test]
fn programming_root_rejects_relative_selections_and_file_parents() {
    assert!(programming_root_at(Path::new("relative")).is_err());
    let temporary = tempfile::tempdir().unwrap();
    let selected = temporary.path().canonicalize_plain().unwrap();
    fs::write(selected.join("HermessAgentDesktop"), "not a directory").unwrap();
    assert!(programming_root_at(&selected).is_err());
}

#[cfg(unix)]
#[test]
fn programming_root_does_not_follow_links_out_of_product_storage() {
    let temporary = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let selected = temporary.path().canonicalize_plain().unwrap();
    std::os::unix::fs::symlink(outside.path(), selected.join("HermessAgentDesktop")).unwrap();
    assert!(programming_root_at(&selected).is_err());
}

#[cfg(windows)]
#[test]
fn programming_root_keeps_plain_windows_paths() {
    let temporary = tempfile::tempdir().unwrap();
    let plain = plain_path(temporary.path());
    let extended = filesystem_path(&plain);
    let root = programming_root_at(&extended).unwrap();
    assert_eq!(root, plain.join("HermessAgentDesktop/programming"));
    assert!(!root.to_string_lossy().starts_with(r"\\?\"));
}

#[cfg(windows)]
#[test]
fn release_storage_uses_local_default_or_saved_selection_without_gateway() {
    let fixture = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = fixture.app.handle();
    assert_eq!(
        release_storage(app).unwrap(),
        plain_path(&app.path().app_local_data_dir().unwrap())
    );
    let selected = plain_path(&app.path().app_config_dir().unwrap()).join("custom-data");
    save_storage_path(app, &selected).unwrap();
    assert_eq!(release_storage(app).unwrap(), selected);
    assert!(!filesystem_path(&selected).exists());
}

#[cfg(windows)]
#[tokio::test]
async fn programming_config_uses_new_root_and_never_imports_old_data() {
    let fixture = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = fixture.app.handle();
    let legacy = plain_path(&app.path().app_config_dir().unwrap()).join("programming");
    fs::create_dir_all(&legacy).unwrap();
    fs::write(
        legacy.join("config.toml"),
        "model_reasoning_effort = 'minimal'\n",
    )
    .unwrap();
    fs::write(legacy.join("connection.enc"), "OLD_DATA_MUST_NOT_BE_READ").unwrap();
    let root = programming_root(app).unwrap();
    assert_eq!(
        root,
        plain_path(&app.path().app_local_data_dir().unwrap())
            .join("HermessAgentDesktop/programming")
    );
    assert!(!filesystem_path(&root).exists());
    let config = super::super::coding_config::read(app).unwrap();
    assert!(!config.has_key);
    assert_ne!(config.effort, "minimal");
    super::super::coding_config::save(
        app,
        super::super::coding_config::CodingConfigDraft {
            enabled: true,
            base_url: "https://fixture.invalid/v1".into(),
            model: "STORAGE_FIXTURE".into(),
            effort: "high".into(),
            api_key: Some("TEST_ONLY_STORAGE_KEY".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        super::super::coding_config::key(app).unwrap(),
        "TEST_ONLY_STORAGE_KEY"
    );
    assert!(root.join("config.toml").is_file());
    assert!(root.join("connection.enc").is_file());
    assert!(root.join("vault/master.key").is_file());
    assert!(!root.with_file_name("hermes-home").exists());
    assert_eq!(
        fs::read_to_string(legacy.join("connection.enc")).unwrap(),
        "OLD_DATA_MUST_NOT_BE_READ"
    );
}
