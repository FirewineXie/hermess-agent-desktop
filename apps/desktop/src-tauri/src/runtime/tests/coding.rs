use super::*;
use crate::runtime::coding_runtime::{install_coding_runtime, CodingRuntimeState};
use tauri::Manager;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
    time::{timeout, Duration},
};

async fn request(app: &tauri::App, value: CodingRequest) -> Value {
    coding_session_request(app.handle().clone(), app.state(), value)
        .await
        .unwrap()
}

async fn settled(app: &tauri::App, id: &str) -> Value {
    timeout(Duration::from_secs(45), async {
        loop {
            let snapshot = request(app, CodingRequest::Read { id: id.into() }).await;
            let live = app.state::<CodingState>();
            let active = live
                .live
                .lock()
                .await
                .get(id)
                .is_some_and(|value| !value.control.is_closed());
            if !active {
                return snapshot;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("native programming task did not settle")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "downloads official Codex and runs the native programming commands with the locked local Hermes Python"]
async fn native_programming_commands_complete_and_stop_owned_worker() {
    crate::process_manager::ProcessManager::init().unwrap();
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = &isolated.app;
    app.manage(CodingState::default());
    app.manage(CodingRuntimeState::default());
    install_coding_runtime(app.handle().clone(), app.state())
        .await
        .unwrap();

    let profiles = request(app, CodingRequest::Permissions { cwd: String::new() }).await;
    let profiles = profiles.as_array().unwrap();
    assert_eq!(profiles.len(), 4);
    assert!(profiles
        .iter()
        .any(|row| row["id"] == "request" && row["allowed"] == true));
    assert!(profiles
        .iter()
        .any(|row| row["id"] == "auto" && row["allowed"] == true));
    let skill_project = tempfile::tempdir().unwrap();
    let skill_dir = skill_project.path().join(".agents/skills/native-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "---\nname: native-skill\ndescription: Native discovery fixture\n---\nNative skill fixture.\n").unwrap();
    let catalog = request(
        app,
        CodingRequest::Skills {
            cwd: plain_path(skill_project.path())
                .to_string_lossy()
                .into_owned(),
        },
    )
    .await;
    let discovered = catalog["skills"]
        .as_array()
        .unwrap()
        .iter()
        .find(|skill| skill["name"] == "native-skill")
        .unwrap();
    assert_eq!(discovered["enabled"], true);
    assert!(!discovered["path"].as_str().unwrap().starts_with("\\\\?\\"));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (seen, mut requests) = mpsc::channel(4);
    let server = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut bytes = vec![];
                let mut chunk = [0; 4096];
                let header_end = loop {
                    let count = socket.read(&mut chunk).await.unwrap();
                    assert!(count > 0 && bytes.len() < 64 * 1024);
                    bytes.extend_from_slice(&chunk[..count]);
                    if let Some(index) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        break index + 4;
                    }
                };
                let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
                assert!(headers.starts_with("POST /v1/responses "));
                assert!(headers
                    .to_ascii_lowercase()
                    .contains("authorization: bearer native_fixture_only"));
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.split_once(':')
                            .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                            .map(|(_, value)| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                assert!(length < 2 * 1024 * 1024);
                while bytes.len() < header_end + length {
                    let count = socket.read(&mut chunk).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&chunk[..count]);
                }
                let body: Value =
                    serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap();
                assert_eq!(
                    body["reasoning"]["effort"], "high",
                    "selected effort must reach Responses"
                );
                assert!(["gpt-5.2-codex", "fixture-alternate-model"]
                    .contains(&body["model"].as_str().unwrap()));
                let (release, gate) = oneshot::channel();
                seen.send((body, release)).await.unwrap();
                let _ = gate.await;
                let item = json!({"type":"message","id":"msg_native","role":"assistant","status":"completed",
                    "content":[{"type":"output_text","text":"RUST_WORKER_OK","annotations":[]}]});
                let events = [
                    json!({"type":"response.created","response":{"id":"resp_native","status":"in_progress","output":[]}}),
                    json!({"type":"response.output_item.added","output_index":0,"item":item}),
                    json!({"type":"response.output_text.delta","item_id":"msg_native","output_index":0,"content_index":0,"delta":"RUST_WORKER_OK"}),
                    json!({"type":"response.output_item.done","output_index":0,"item":item}),
                    json!({"type":"response.completed","response":{"id":"resp_native","status":"completed","output":[item],
                        "usage":{"input_tokens":10,"output_tokens":3,"total_tokens":13}}}),
                ];
                let wire: String = events
                    .iter()
                    .map(|event| {
                        format!(
                            "event: {}\ndata: {event}\n\n",
                            event["type"].as_str().unwrap()
                        )
                    })
                    .collect();
                let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{wire}", wire.len());
                let _ = socket.write_all(reply.as_bytes()).await;
            });
        }
    });
    let draft = || CodingConfigDraft {
        enabled: true,
        base_url: format!("http://{address}/v1"),
        model: "gpt-5.2-codex".into(),
        effort: "medium".into(),
        api_key: Some("NATIVE_FIXTURE_ONLY".into()),
    };
    save_coding_config(app.handle().clone(), app.state(), draft())
        .await
        .unwrap();
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.build")
        .join(format!("coding-native-{}", Uuid::new_v4()));
    fs::create_dir_all(&workspace).unwrap();
    let created = request(
        app,
        CodingRequest::Create {
            project_id: None,
            model_id: None,
            cwd: plain_path(&workspace).to_string_lossy().into_owned(),
        },
    )
    .await;
    let id = created["id"].as_str().unwrap().to_owned();
    // Exercise the same Send boundary as the production Tauri adapter, including rejection.
    for invalid in ["data:image/png;base64,%%%", "data:image/png;base64,AA=="] {
        assert!(coding_session_request(
            app.handle().clone(),
            app.state(),
            CodingRequest::Send {
                effort: Some("high".into()),
                permissions: None,
                id: id.clone(),
                text: "Rejected image".into(),
                images: vec![invalid.into()],
            }
        )
        .await
        .is_err());
    }
    let png = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKUlEQVR4nO3NsQ0AAAzCMP5/mj5RNkuZ4zSZtr0DAAAAAAAAAACA/gEHMsP8LofXz44AAAAASUVORK5CYII=";
    let clipboard = format!("data:image/png;base64,{png}");
    let image_path = workspace.join("drop.png");
    fs::write(
        &image_path,
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, png).unwrap(),
    )
    .unwrap();
    let file_path = workspace.join("reference.txt");
    fs::write(&file_path, "FILE_REFERENCE_FIXTURE").unwrap();
    let text = format!(
        "Reply with the fixture text\n@{}",
        serde_json::to_string(&plain_path(&file_path)).unwrap()
    );
    request(
        app,
        CodingRequest::Send {
            effort: Some("high".into()),
            permissions: None,
            id: id.clone(),
            text,
            images: vec![
                clipboard.clone(),
                plain_path(&image_path).to_string_lossy().into_owned(),
            ],
        },
    )
    .await;
    let (body, release) = timeout(Duration::from_secs(40), requests.recv())
        .await
        .expect("native worker never reached Responses endpoint")
        .unwrap();
    let input = body["input"].to_string();
    assert!(input.contains("reference.txt"));
    let image_urls: Vec<_> = body["input"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["content"].as_array())
        .flatten()
        .filter(|part| part["type"] == "input_image")
        .map(|part| part["image_url"].as_str().unwrap())
        .collect();
    assert_eq!(image_urls, vec![clipboard.as_str(), clipboard.as_str()]);
    assert!(
        save_coding_config(app.handle().clone(), app.state(), draft())
            .await
            .is_err()
    );
    assert!(coding_session_request(
        app.handle().clone(),
        app.state(),
        CodingRequest::Send {
            effort: Some("high".into()),
            permissions: None,
            id: id.clone(),
            text: "Duplicate must be rejected".into(),
            images: vec![]
        }
    )
    .await
    .is_err());
    assert!(coding_session_request(
        app.handle().clone(),
        app.state(),
        CodingRequest::Remove { id: id.clone() }
    )
    .await
    .is_err());
    release.send(()).unwrap();
    let first = settled(app, &id).await;
    assert_eq!(
        first["status"], "completed",
        "sanitized task failure: {}",
        first["error"]
    );
    assert_eq!(first["messages"][1]["text"], "RUST_WORKER_OK");
    assert!(
        first["messages"][0]["timing"]["started_at_ms"]
            .as_u64()
            .unwrap()
            > 0
    );
    assert!(
        first["messages"][0]["timing"]["elapsed_ms"]
            .as_u64()
            .unwrap()
            > 0
    );
    assert!(!app
        .state::<CodingState>()
        .live
        .lock()
        .await
        .contains_key(&id));
    let thread = first["thread_id"].clone();
    assert!(thread.is_string());

    request(
        app,
        CodingRequest::Send {
            effort: Some("high".into()),
            permissions: None,
            id: id.clone(),
            text: "Wait until stopped".into(),
            images: vec![],
        },
    )
    .await;
    let (resumed_body, waiting_release) = timeout(Duration::from_secs(40), requests.recv())
        .await
        .expect("resumed worker never reached endpoint")
        .unwrap();
    assert!(resumed_body["input"]
        .to_string()
        .contains("Reply with the fixture text"));

    let second_workspace = workspace.join("second-project");
    fs::create_dir(&second_workspace).unwrap();
    let second = request(
        app,
        CodingRequest::Create {
            project_id: None,
            model_id: None,
            cwd: plain_path(&second_workspace).to_string_lossy().into_owned(),
        },
    )
    .await;
    let second_id = second["id"].as_str().unwrap().to_owned();
    request(
        app,
        CodingRequest::Send {
            effort: Some("high".into()),
            permissions: None,
            id: second_id.clone(),
            text: "SECOND_SESSION_ONLY".into(),
            images: vec![],
        },
    )
    .await;
    let (second_body, second_release) = timeout(Duration::from_secs(40), requests.recv())
        .await
        .expect("second worker never reached endpoint")
        .unwrap();
    let second_input = second_body["input"].to_string();
    assert!(second_input.contains("SECOND_SESSION_ONLY"));
    assert!(!second_input.contains("Reply with the fixture text"));
    assert!(!second_input.contains("Wait until stopped"));
    assert!(!second_input.contains("RUST_WORKER_OK"));
    second_release.send(()).unwrap();
    let second_finished = settled(app, &second_id).await;
    assert_eq!(
        second_finished["status"], "completed",
        "{}",
        second_finished["error"]
    );
    assert_ne!(second_finished["thread_id"], thread);
    assert_eq!(second_finished["cwd"], second["cwd"]);
    assert_eq!(second_finished["messages"].as_array().unwrap().len(), 2);
    assert_eq!(
        request(app, CodingRequest::Read { id: id.clone() }).await["status"],
        "running"
    );
    request(app, CodingRequest::Stop { id: id.clone() }).await;
    let stopped = settled(app, &id).await;
    assert_eq!(stopped["status"], "stopped");
    assert!(stopped["messages"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|message| message["role"] == "user")
        .unwrap()["timing"]["elapsed_ms"]
        .is_u64());
    assert_eq!(stopped["thread_id"], thread);
    drop(waiting_release);
    let second_after_stop = request(
        app,
        CodingRequest::Read {
            id: second_id.clone(),
        },
    )
    .await;
    assert_eq!(second_after_stop, second_finished);
    let listed = request(app, CodingRequest::List).await;
    assert_eq!(listed.as_array().unwrap().len(), 2);
    request(
        app,
        CodingRequest::Command {
            id: id.clone(),
            command: json!({"type":"plan", "mode":"plan"}),
            permissions: None,
            effort: None,
        },
    )
    .await;
    let planning = request(app, CodingRequest::Read { id: id.clone() }).await;
    assert_eq!(planning["context"]["mode"], "plan");
    assert!(coding_session_request(app.handle().clone(), app.state(), CodingRequest::Command {
        id: id.clone(), command: json!({"type":"goal", "action":"set", "objective":"Must not start during planning"}), permissions: None, effort: None
    }).await.is_err());
    request(
        app,
        CodingRequest::Command {
            id: id.clone(),
            command: json!({"type":"plan", "mode":"default"}),
            permissions: None,
            effort: None,
        },
    )
    .await;
    request(
        app,
        CodingRequest::Command {
            id: id.clone(),
            command: json!({"type":"goal", "action":"get"}),
            permissions: None,
            effort: None,
        },
    )
    .await;
    let inspected = settled(app, &id).await;
    assert_eq!(inspected["status"], "completed");
    assert_eq!(inspected["context"]["mode"], "default");
    assert!(inspected["context"]["goal"].is_null());
    assert!(
        requests.try_recv().is_err(),
        "Goal inspection must not start a model request"
    );
    request(app, CodingRequest::Remove { id: id.clone() }).await;
    assert_eq!(
        request(
            app,
            CodingRequest::Read {
                id: second_id.clone()
            }
        )
        .await,
        second_finished
    );
    assert!(!app
        .state::<CodingState>()
        .live
        .lock()
        .await
        .contains_key(&id));
    assert!(
        save_coding_config(app.handle().clone(), app.state(), draft())
            .await
            .is_ok()
    );
    // Route a non-default catalog model through the real native Create/Send path.
    let catalog = crate::runtime::coding_catalog::apply(
        app.handle(),
        crate::runtime::coding_catalog::load(app.handle()).unwrap(),
        crate::runtime::coding_catalog::ProviderDraft {
            id: None,
            name: "Alternate fixture".into(),
            region: "overseas".into(),
            base_url: format!("http://{address}/v1"),
            api_key: None,
            models: vec!["fixture-alternate-model".into()],
        },
        "NATIVE_FIXTURE_ONLY".into(),
    )
    .unwrap();
    let alternate_id = catalog.providers.last().unwrap().models[0].id.clone();
    assert_ne!(alternate_id, catalog.default_model);
    // Follow the current tray sequence with a live programming turn.
    let quitting = request(
        app,
        CodingRequest::Create {
            project_id: None,
            model_id: Some(alternate_id),
            cwd: plain_path(&workspace).to_string_lossy().into_owned(),
        },
    )
    .await;
    let quitting_id = quitting["id"].as_str().unwrap().to_owned();
    request(
        app,
        CodingRequest::Send {
            effort: Some("high".into()),
            permissions: None,
            id: quitting_id.clone(),
            text: "SHUTDOWN_PENDING".into(),
            images: vec![],
        },
    )
    .await;
    let (quitting_body, quitting_release) = timeout(Duration::from_secs(40), requests.recv())
        .await
        .expect("shutdown worker never reached endpoint")
        .unwrap();
    assert_eq!(quitting_body["model"], "fixture-alternate-model");
    let processes = crate::process_manager::ProcessManager::current().unwrap();
    assert!(processes.begin_shutdown());
    assert!(shutdown(app.handle()).await);
    let shutdown_manager = processes.clone();
    let closed = tokio::task::spawn_blocking(move || shutdown_manager.kill_temporary())
        .await
        .unwrap();
    assert!(!closed.iter().any(|(kind, _)| *kind == "programming"));
    let quit_record = settled(app, &quitting_id).await;
    assert_eq!(
        quit_record["status"], "stopped",
        "intentional desktop exit must settle as cancellation"
    );
    drop(quitting_release);
    assert!(coding_session_request(
        app.handle().clone(),
        app.state(),
        CodingRequest::Send {
            effort: Some("high".into()),
            permissions: None,
            id: second_id.clone(),
            text: "must not start while exiting".into(),
            images: vec![],
        }
    )
    .await
    .is_err());
    assert_eq!(
        request(app, CodingRequest::Read { id: second_id }).await,
        second_finished
    );
    assert!(processes.kill_remaining().is_empty());
    server.abort();
    assert!(workspace
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("coding-native-"));
    fs::remove_dir_all(&workspace).unwrap();
}

#[test]
fn approval_answers_require_active_request_and_an_offered_option() {
    let mut session: CodingSession = serde_json::from_value(json!({
        "id":"s", "title":"t", "cwd":"", "config_id":"", "model":"", "thread_id":null,
        "messages":[], "status":"running", "output":"", "error":"", "activity":"",
        "approval":{"id":"request", "options":[{"id":"option-1", "kind":"command_rule"}]}
    }))
    .unwrap();
    assert_eq!(
        approval_kind(&session, "request", "option-1").unwrap(),
        "command_rule"
    );
    assert!(approval_kind(&session, "request", "invented-choice").is_err());
    assert!(approval_kind(&session, "stale-request", "option-1").is_err());
    session.status = "completed".into();
    assert!(approval_kind(&session, "request", "option-1").is_err());
    session.approval = None;
    assert!(approval_kind(&session, "request", "option-1").is_err());
}

#[tokio::test]
async fn branch_switch_refuses_when_another_chat_is_running_in_the_same_worktree() {
    let fixture = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = &fixture.app;
    app.manage(CodingState::default());
    let repo = app.path().app_config_dir().unwrap().join("project");
    fs::create_dir_all(repo.join(".git")).unwrap();
    fs::create_dir_all(repo.join("nested")).unwrap();
    let session: CodingSession = serde_json::from_value(json!({
        "id":"running-chat", "title":"t", "cwd":repo, "config_id":"", "model":"", "thread_id":null,
        "messages":[], "status":"running", "output":"", "error":"", "activity":"", "approval":null
    }))
    .unwrap();
    let (tx, _rx) = mpsc::channel(1);
    app.state::<CodingState>().live.lock().await.insert(
        "running-chat".into(),
        LiveSession {
            session: Arc::new(Mutex::new(session)),
            control: tx,
        },
    );
    let error = coding_session_request(
        app.handle().clone(),
        app.state(),
        CodingRequest::SwitchBranch {
            cwd: crate::paths::plain_path(&repo.join("nested"))
                .to_string_lossy()
                .into_owned(),
            branch: "other".into(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(serde_json::to_value(error).unwrap()["code"], "conflict");
}
