use super::{replace_file, target_path, TemporaryFile};

async fn save_fixture() -> (super::BackendState, super::MediaEntry) {
    use crate::runtime::{
        media::{MediaResource, MediaScope},
        media_source::MediaOwner,
        remote_config::RemoteGatewayConfig,
        remote_gateway::ActiveRemote,
    };
    let client = crate::gateway::media_test_support::idle_gateway("save-epoch");
    let state = super::BackendState::default();
    *state.5.lock().await = Some(ActiveRemote {
        config: RemoteGatewayConfig {
            id: "save-test".into(),
            label: "save-test".into(),
            url: "http://127.0.0.1".into(),
        },
        gateway: std::sync::Arc::clone(&client),
        selected_profile: "default".into(),
        session_owners: std::sync::Arc::default(),
        storage: std::env::temp_dir(),
    });
    let entry = super::MediaEntry {
        resource: MediaResource {
            id: uuid::Uuid::new_v4().to_string(),
            name: "saved.bin".into(),
            kind: "file".into(),
            mime: "application/octet-stream".into(),
            size: Some(11),
            local: false,
        },
        owner: MediaOwner {
            scope: MediaScope {
                profile: "default".into(),
                session_id: "save-session".into(),
                gateway_epoch: "save-epoch".into(),
            },
            client,
            remote: true,
            base_url: "http://127.0.0.1".into(),
        },
        window: "main".into(),
        source: super::MediaSource::Data(std::sync::Arc::new(b"replacement".to_vec())),
        released: std::sync::atomic::AtomicBool::new(false),
        cancel: tokio::sync::Notify::new(),
    };
    (state, entry)
}

#[tokio::test]
async fn production_save_commits_success_and_preserves_target_on_failure() {
    let root = std::env::temp_dir().join(format!("hermess-media-save-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let destination = root.join("saved.bin");
    let (state, mut entry) = save_fixture().await;
    std::fs::write(&destination, b"original").unwrap();
    super::save(&entry, &state, &destination.to_string_lossy())
        .await
        .unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"replacement");
    // A changed source size must fail before the replace commit point.
    entry.resource.size = Some(12);
    std::fs::write(&destination, b"keep-me").unwrap();
    assert!(super::save(&entry, &state, &destination.to_string_lossy())
        .await
        .is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), b"keep-me");
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
    entry.resource.size = Some(11);
    entry
        .released
        .store(true, std::sync::atomic::Ordering::Release);
    assert!(super::save(&entry, &state, &destination.to_string_lossy())
        .await
        .is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), b"keep-me");
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn save_preserves_existing_destination_and_cleans_partial_output() {
    let root = std::env::temp_dir().join(format!("hermess-media-save-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let destination = root.join("saved.bin");
    assert!(target_path(&destination.to_string_lossy()).is_ok());
    std::fs::write(&destination, b"original").unwrap();
    assert!(target_path(&destination.to_string_lossy()).is_ok());
    assert_eq!(std::fs::read(&destination).unwrap(), b"original");
    let partial = root.join(".test.part");
    std::fs::write(&partial, b"partial").unwrap();
    drop(TemporaryFile {
        path: partial.clone(),
        file: None,
        resource_id: "cleanup-test".into(),
    });
    assert!(!partial.exists());
    assert!(target_path("relative.bin").is_err());
    std::fs::write(&partial, b"replacement").unwrap();
    replace_file(&partial, &destination).unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"replacement");
    assert!(!partial.exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn html_retains_existing_twenty_mib_limit_while_text_stays_bounded() {
    let path =
        std::env::temp_dir().join(format!("hermess-media-html-{}.html", uuid::Uuid::new_v4()));
    std::fs::write(&path, vec![b'x'; 3 * 1024 * 1024]).unwrap();
    let source = super::MediaSource::Local(path.clone());
    let html = super::preview_source(&source, "text/html").await.unwrap();
    assert_eq!(html.kind, "html");
    assert!(!html.truncated);
    assert_eq!(html.content.len(), 3 * 1024 * 1024);
    let text = super::preview_source(&source, "text/plain").await.unwrap();
    assert_eq!(text.kind, "text");
    assert!(text.truncated);
    assert_eq!(text.content.len(), super::MAX_PREVIEW);
    std::fs::write(&path, vec![b'x'; super::MAX_HTML_PREVIEW + 1]).unwrap();
    let too_large = super::preview_source(&source, "text/html").await.unwrap();
    assert_eq!(too_large.kind, "text");
    assert!(too_large.truncated);
    std::fs::remove_file(path).unwrap();
}
