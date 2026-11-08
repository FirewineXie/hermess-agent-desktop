use super::*;
use std::io::Cursor;

#[test]
#[ignore = "requires a downloaded official archive via HERMESS_CODEX_TEST_ARCHIVE"]
fn official_archive_passes_hash_and_production_extraction() {
    let path = std::env::var_os("HERMESS_CODEX_TEST_ARCHIVE").expect("archive path");
    let path = Path::new(&path);
    let lock = lock().unwrap();
    let asset = &lock.assets[target()];
    assert_eq!(fs::metadata(path).unwrap().len(), asset.size);
    assert_eq!(
        format!("{:x}", Sha256::digest(fs::read(path).unwrap())),
        asset.sha256
    );
    let directory = std::env::temp_dir().join(format!(
        "hermess-official-runtime-test-{}",
        uuid::Uuid::new_v4()
    ));
    extract(path, &directory).expect("real official archive accepted by production extractor");
    assert!(directory.join(binary_name()).is_file());
    assert!(directory
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("hermess-official-runtime-test-"));
    fs::remove_dir_all(directory).unwrap();
}
#[test]
fn pinned_release_has_all_product_targets() {
    let lock = lock().unwrap();
    assert_eq!(lock.repository, "openai/codex");
    assert_eq!(lock.tag, format!("rust-v{}", lock.version));
    for target in [
        "x86_64-pc-windows-msvc",
        "aarch64-apple-darwin",
        "x86_64-apple-darwin",
        "x86_64-unknown-linux-musl",
    ] {
        let asset = &lock.assets[target];
        assert_eq!(asset.name, format!("codex-package-{target}.tar.gz"));
        assert_eq!(asset.sha256.len(), 64);
    }
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "downloads the pinned official runtime from GitHub into an isolated product config"]
async fn native_download_command_installs_and_reuses_verified_runtime() {
    use tauri::Manager;
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    isolated.app.manage(CodingRuntimeState::default());
    let app = isolated.app.handle();
    let before = get_coding_runtime(app.clone(), isolated.app.state())
        .await
        .unwrap();
    assert_eq!(before.state, "missing");
    install_coding_runtime(app.clone(), isolated.app.state())
        .await
        .unwrap();
    let installed = get_coding_runtime(app.clone(), isolated.app.state())
        .await
        .unwrap();
    assert_eq!(installed.state, "installed");
    assert!(executable(app).unwrap().is_file());
    install_coding_runtime(app.clone(), isolated.app.state())
        .await
        .unwrap();
    assert!(!coding_config::root(app)
        .unwrap()
        .join("vault/master.key")
        .exists());
}
#[test]
fn archive_links_are_rejected_before_publishing() {
    let root = std::env::temp_dir().join(format!("hermess-archive-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let archive = root.join("archive.tar.gz");
    let encoder = flate2::write::GzEncoder::new(
        fs::File::create(&archive).unwrap(),
        flate2::Compression::default(),
    );
    let mut builder = tar::Builder::new(encoder);
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_size(0);
    header.set_mode(0o755);
    header.set_link_name("../../outside").unwrap();
    header.set_cksum();
    builder
        .append_data(&mut header, "bad-link", Cursor::new([]))
        .unwrap();
    builder.into_inner().unwrap().finish().unwrap();
    let destination = root.join("extracted");
    assert!(extract(&archive, &destination).is_err());
    assert!(!destination.join(".hermess-verified").exists());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "requires official archive via HERMESS_CODEX_TEST_ARCHIVE"]
async fn installed_runtime_recovers_cached_failure_without_download() {
    use tauri::Manager;
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    isolated.app.manage(CodingRuntimeState::default());
    let app = isolated.app.handle();
    let archive = std::env::var_os("HERMESS_CODEX_TEST_ARCHIVE").expect("archive path");
    let destination = directory(app).unwrap();
    extract(Path::new(&archive), &destination).unwrap();
    let state = isolated.app.state::<CodingRuntimeState>();
    let mut failed = get_coding_runtime(app.clone(), isolated.app.state())
        .await
        .unwrap();
    failed.state = "failed".into();
    *state.progress.lock().await = Some(failed);
    assert_eq!(
        get_coding_runtime(app.clone(), isolated.app.state())
            .await
            .unwrap()
            .state,
        "installed"
    );
    install_coding_runtime(app.clone(), isolated.app.state())
        .await
        .unwrap();
    assert!(state.progress.lock().await.is_none());
    assert!(executable(app).unwrap().is_file());
}
