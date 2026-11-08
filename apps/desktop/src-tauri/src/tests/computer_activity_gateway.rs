use super::*;

#[tokio::test]
#[ignore = "requires the locked Hermes Python environment; exercises its actual dispatcher"]
async fn production_stop_request_reaches_locked_gateway() {
    for profile in ["default", "writer"] {
        let (sender, mut receiver) = mpsc::channel(1);
        let stop = GatewayStop {
            sender,
            profile: profile.into(),
            session: "s".into(),
            generation: 1,
        };
        let task = tokio::spawn(async move { stop.interrupt().await });
        let Some(GatewayCommand::Rpc(request)) = receiver.recv().await else {
            panic!("missing production request")
        };
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let mut command = tokio::process::Command::new(
            repo.join("upstream/hermes-agent/.venv/Scripts/python.exe"),
        );
        command
            .arg("-I")
            .arg(repo.join("apps/desktop/tests/computer_activity_gateway_receiver.py"))
            .arg(request.params.to_string());
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let output =
            tokio::time::timeout(Duration::from_secs(25), command.kill_on_drop(true).output())
                .await
                .unwrap()
                .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(result["accepted"], true);
        request.reply.send(Ok(result)).unwrap();
        assert!(task.await.unwrap().is_ok());
    }
}

#[test]
fn native_provider_does_not_label_remote_or_unreadable_configs_as_local() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    std::fs::create_dir_all(root.join("profiles/writer")).unwrap();
    assert!(native_provider(&root, "default"));
    assert!(native_provider(&root, "writer"));
    std::fs::write(
        root.join("config.yaml"),
        "computer_use:\n  backend: remote-desktop\n",
    )
    .unwrap();
    assert!(!native_provider(&root, "default"));
    std::fs::write(
        root.join("profiles/writer/config.yaml"),
        "computer_use:\n  backend: cua\n",
    )
    .unwrap();
    assert!(native_provider(&root, "writer"));
    assert!(!native_provider(&root, "../writer"));
    std::fs::write(root.join("config.yaml"), "[broken").unwrap();
    assert!(!native_provider(&root, "default"));
}

#[tokio::test]
async fn stop_is_scoped_to_the_original_profile_and_execution_generation() {
    for profile in ["default", "writer"] {
        let (sender, mut receiver) = mpsc::channel(1);
        let stop = GatewayStop {
            sender,
            profile: profile.into(),
            session: "computer-session".into(),
            generation: 7,
        };
        let task = tokio::spawn(async move { stop.interrupt().await });
        let Some(GatewayCommand::Rpc(request)) = receiver.recv().await else {
            panic!("missing stop")
        };
        assert_eq!(request.method, "session.interrupt");
        assert_eq!(request.params["session_id"], "computer-session");
        assert_eq!(request.params["execution_generation"], 7);
        assert_eq!(
            request.params.get("profile").and_then(Value::as_str),
            (profile != "default").then_some(profile)
        );
        request
            .reply
            .send(Err(GatewayRequestError::Rpc {
                message: "stale_generation".into(),
                code: -32000,
            }))
            .unwrap();
        assert!(task.await.unwrap().is_err());
        assert!(
            receiver.recv().await.is_none(),
            "must not retry by stopping a new generation"
        );
    }
}
