use super::*;

#[cfg(windows)]
#[tokio::test]
async fn failed_config_replacement_preserves_both_files_and_can_retry() {
    use std::os::windows::fs::OpenOptionsExt;

    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = isolated.app.handle();
    let draft = |model: &str, effort: &str, secret: &str| CodingConfigDraft {
        enabled: true,
        base_url: "https://fixture.invalid/v1".into(),
        model: model.into(),
        effort: effort.into(),
        api_key: Some(secret.into()),
    };
    let first = save(app, draft("MODEL_OLD", "medium", "KEY_OLD_FIXTURE"))
        .await
        .unwrap();
    let directory = root(app).unwrap();
    let toml_path = directory.join("config.toml");
    let connection_path = directory.join("connection.enc");
    let original_text = "# external comment\nmodel_reasoning_effort = 'medium'\n";
    fs::write(&toml_path, original_text).unwrap();
    let original_connection = fs::read(&connection_path).unwrap();

    // Real Windows sharing violations: TOML replacement fails before the
    // connection write; connection replacement fails after TOML was written.
    for locked_path in [&toml_path, &connection_path] {
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(locked_path)
            .unwrap();
        assert!(save(app, draft("MODEL_NEW", "high", "KEY_NEW_FIXTURE"))
            .await
            .is_err());
        assert_eq!(fs::read_to_string(&toml_path).unwrap(), original_text);
        assert_eq!(fs::read(&connection_path).unwrap(), original_connection);
        let restored = read(app).unwrap();
        assert_eq!(restored.id, first.id);
        assert_eq!(restored.model, "MODEL_OLD");
        assert_eq!(restored.effort, "medium");
        assert_eq!(key(app).unwrap(), "KEY_OLD_FIXTURE");
        assert!(!fs::read_dir(&directory).unwrap().any(|entry| entry
            .unwrap()
            .path()
            .extension()
            .is_some_and(|extension| extension == "tmp")));
        drop(lock);
    }

    let retried = save(app, draft("MODEL_NEW", "high", "KEY_NEW_FIXTURE"))
        .await
        .unwrap();
    assert_ne!(retried.id, first.id);
    assert_eq!(retried.model, "MODEL_NEW");
    assert_eq!(retried.effort, "high");
    assert_eq!(key(app).unwrap(), "KEY_NEW_FIXTURE");
    assert!(fs::read_to_string(toml_path)
        .unwrap()
        .contains("# external comment"));
}
#[test]
fn connection_accepts_base_url_and_rejects_protocol_paths_and_embedded_auth() {
    let mut draft = CodingConfigDraft {
        enabled: true,
        base_url: "https://gateway.example/v1".into(),
        model: "test-model".into(),
        effort: "medium".into(),
        api_key: Some("TEST_ONLY".into()),
    };
    assert!(validate(&draft).is_ok());
    for url in [
        "https://gateway.example/v1/chat/completions",
        "https://gateway.example/v1/responses",
        "https://user:password@gateway.example/v1",
        "https://gateway.example/v1?key=test",
    ] {
        draft.base_url = url.into();
        assert!(validate(&draft).is_err());
    }
}

#[cfg(windows)]
#[tokio::test]
async fn encrypted_global_storage_keeps_connection_identity_when_only_key_changes() {
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = isolated.app.handle();
    let directory = root(app).unwrap();
    super::super::coding_vault::private_directory(&directory).unwrap();
    fs::write(
        directory.join("config.toml"),
        "# preserve this comment\nmodel = 'IGNORED_MODEL'\n",
    )
    .unwrap();
    let draft = || CodingConfigDraft {
        enabled: true,
        base_url: "https://fixture.invalid/v1".into(),
        model: "MODEL_FIXTURE_ONLY".into(),
        effort: "high".into(),
        api_key: Some("KEY_FIXTURE_ONLY".into()),
    };
    let first = save(app, draft()).await.unwrap();
    assert!(first.has_key);
    assert_eq!(first.ignored_fields, vec!["model"]);
    assert_eq!(key(app).unwrap(), "KEY_FIXTURE_ONLY");
    let bytes = fs::read(directory.join("connection.enc")).unwrap();
    for secret in ["fixture.invalid", "MODEL_FIXTURE_ONLY", "KEY_FIXTURE_ONLY"] {
        assert!(!bytes
            .windows(secret.len())
            .any(|part| part == secret.as_bytes()));
    }
    let mut rotated = draft();
    rotated.api_key = Some("ROTATED_FIXTURE_ONLY".into());
    assert_eq!(save(app, rotated).await.unwrap().id, first.id);
    assert_eq!(key(app).unwrap(), "ROTATED_FIXTURE_ONLY");
    let mut changed = draft();
    changed.model = "DIFFERENT_MODEL".into();
    assert_ne!(save(app, changed).await.unwrap().id, first.id);
    let text = fs::read_to_string(directory.join("config.toml")).unwrap();
    assert!(text.contains("# preserve this comment") && text.contains("IGNORED_MODEL"));
    fs::remove_file(directory.join("vault/master.key")).unwrap();
    assert!(save(app, draft()).await.is_err());
    assert!(!directory.join("vault/master.key").exists());
}
