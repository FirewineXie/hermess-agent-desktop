use super::*;
use crate::computer_activity::{self, ComputerActivityState};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs,
};
use tokio::{io::AsyncReadExt, net::TcpListener};

fn processes() -> HashMap<u32, (u32, String)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    let mut result = HashMap::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        assert_ne!(snapshot, INVALID_HANDLE_VALUE);
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut next = Process32FirstW(snapshot, &mut entry);
        while next != 0 {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            result.insert(
                entry.th32ProcessID,
                (
                    entry.th32ParentProcessID,
                    String::from_utf16_lossy(&entry.szExeFile[..end]),
                ),
            );
            next = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    result
}

fn descendants(root: u32) -> Vec<(u32, String)> {
    let all = processes();
    let mut owned = HashSet::from([root]);
    loop {
        let before = owned.len();
        for (pid, (parent, _)) in &all {
            if owned.contains(parent) {
                owned.insert(*pid);
            }
        }
        if owned.len() == before {
            break;
        }
    }
    all.into_iter()
        .filter(|(pid, _)| owned.contains(pid) && *pid != root)
        .map(|(pid, (_, name))| (pid, name))
        .collect()
}

#[test]
#[ignore = "Windows real Codex/driver stop integration; requires prepared isolated computer-activity tool/dependency fixtures"]
fn shared_takeover_stops_real_codex_worker_and_driver_tree() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let identifier = format!(
        "com.hermess.ct-{}",
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    );
    context.config_mut().identifier = identifier.clone();
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1438".parse().unwrap());
    let outcome = Arc::new(std::sync::Mutex::new(None));
    let result = outcome.clone();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(ComputerActivityState::default())
        .manage(coding::CodingState::default())
        .invoke_handler(tauri::generate_handler![
            computer_activity::get_computer_activity,
            computer_activity::stop_computer_activity
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let test_app = handle.clone();
                let run = tauri::async_runtime::spawn(async move { run_takeover(test_app).await });
                let finished = tokio::time::timeout(Duration::from_secs(75), run).await;
                *result.lock().unwrap() = Some(format!("{finished:?}"));
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    let roots = [
        app.path().app_config_dir().unwrap(),
        app.path().app_data_dir().unwrap(),
        app.path().app_local_data_dir().unwrap(),
    ];
    app.run_return(|_, _| {});
    for root in roots {
        assert_eq!(root.file_name().unwrap().to_string_lossy(), identifier);
        let _ = fs::remove_dir_all(crate::paths::filesystem_path(&root));
    }
    assert_eq!(outcome.lock().unwrap().as_deref(), Some("Ok(Ok(()))"));
}

async fn run_takeover(app: tauri::AppHandle) {
    crate::process_manager::ProcessManager::current()
        .or_else(|_| crate::process_manager::ProcessManager::init())
        .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let mut data = Vec::new();
                let body_start;
                loop {
                    let mut chunk = [0; 8192];
                    let count = socket.read(&mut chunk).await.unwrap();
                    if count == 0 {
                        return;
                    }
                    data.extend_from_slice(&chunk[..count]);
                    if let Some(index) = data.windows(4).position(|part| part == b"\r\n\r\n") {
                        body_start = index + 4;
                        break;
                    }
                }
                let headers = String::from_utf8_lossy(&data[..body_start]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length:")
                            .map(|s| s.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                while data.len() < body_start + length {
                    let mut chunk = [0; 8192];
                    let count = socket.read(&mut chunk).await.unwrap();
                    if count == 0 {
                        return;
                    }
                    data.extend_from_slice(&chunk[..count]);
                }
                let body: Value =
                    serde_json::from_slice(&data[body_start..body_start + length]).unwrap();
                assert!(body["tools"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|tool| tool["name"] == "hermess_computer_use"));
                let waited = body["input"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|item| item["type"] == "function_call_output");
                let (call, arguments) = if waited {
                    ("wait", "{\"action\":\"wait\",\"seconds\":30}")
                } else {
                    ("list", "{\"action\":\"list_apps\"}")
                };
                let item = json!({"type":"function_call","id":format!("fc_{call}"),"call_id":format!("call_{call}"),"name":"hermess_computer_use", "arguments":arguments,"status":"completed"});
                let events = [
                    json!({"type":"response.created","response":{"id":"stop-test","status":"in_progress","output":[]}}),
                    json!({"type":"response.output_item.added","output_index":0,"item":item}),
                    json!({"type":"response.output_item.done","output_index":0,"item":item}),
                    json!({"type":"response.completed","response":{"id":"stop-test","status":"completed","output":[item],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}),
                ];
                let wire: String = events
                    .iter()
                    .map(|event| {
                        format!(
                            "event: {}\ndata: {}\n\n",
                            event["type"].as_str().unwrap(),
                            event
                        )
                    })
                    .collect();
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{wire}", wire.len());
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    });
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_plain()
        .unwrap();
    let root = coding_config::root(&app).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let home = root.join("threads").join(&id);
    let project = root.join("project");
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&project).unwrap();
    let session = Arc::new(Mutex::new(CodingSession {
        archived: false,
        context: None,
        project_id: None,
        id: id.clone(),
        title: "Desktop stop test".into(),
        cwd: plain_path(&project).to_string_lossy().into_owned(),
        config_id: "fixture".into(),
        model: "gpt-5.2-codex".into(),
        thread_id: None,
        messages: vec![],
        status: "running".into(),
        output: String::new(),
        error: String::new(),
        activity: String::new(),
        approval: None,
    }));
    let hermes = repo.join("upstream/hermes-agent/.venv/Scripts/hermes.exe");
    let mut command = command(&hermes, &home).unwrap();
    let worker_stderr = root.join("worker-stderr.log");
    command.stderr(Stdio::from(fs::File::create(&worker_stderr).unwrap()));
    command.env(
        "PYTHONPATH",
        std::env::join_paths([
            repo.join(".build/computer-activity-python-deps"),
            repo.join(".build/payload/venv/Lib/site-packages"),
            repo.join("upstream/hermes-agent"),
        ])
        .unwrap(),
    );
    let (child, registration) =
        crate::process_manager::spawn(&mut command, "coding_computer_test").unwrap();
    let worker_pid = child.id().unwrap();
    let payload = json!({"home":plain_path(&home),"private_root":plain_path(&root),"connection_id":"fixture","cwd":plain_path(&project),"model":"gpt-5.2-codex",
        "base_url":format!("http://127.0.0.1:{port}/v1"),"effort":"low","executable":plain_path(&repo.join(".build/codex-probe/bin/codex.exe")),"api_key":"STOP_TEST_ONLY_KEY",
        "thread_id":null,"text":"Use the desktop wait tool once","images":[],"permissions":"request","computer_tools_roots":[plain_path(&repo.join(".build/computer-activity-tools"))]});
    let (sender, receiver) = mpsc::channel(8);
    let task = tokio::spawn(run(
        app.clone(),
        id,
        session.clone(),
        child,
        registration,
        payload,
        sender.clone(),
        receiver,
    ));
    let approval = tokio::time::timeout(Duration::from_secs(25), async {
        loop {
            if let Some(approval) = session.lock().await.approval.clone() {
                break approval;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("real desktop approval");
    let once = approval["options"]
        .as_array()
        .unwrap()
        .iter()
        .find(|option| option["kind"] == "once")
        .unwrap();
    sender
        .send(json!({"kind":"approval","id":approval["id"],"option_id":once["id"]}))
        .await
        .unwrap();
    let next = tokio::time::timeout(Duration::from_secs(25), async {
        loop {
            {
                let current = session.lock().await;
                assert_eq!(
                    current.status,
                    "running",
                    "worker ended before second approval: error={} tools={:?}",
                    current.error,
                    current
                        .messages
                        .iter()
                        .filter_map(|message| message.tool.as_ref())
                        .map(|tool| (
                            tool["status"].clone(),
                            tool["output"]
                                .as_str()
                                .unwrap_or("")
                                .chars()
                                .take(1500)
                                .collect::<String>()
                        ))
                        .collect::<Vec<_>>()
                );
            }
            let next = session.lock().await.approval.clone();
            if let Some(next) = next.filter(|next| next["id"] != approval["id"]) {
                break next;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    })
    .await
    .expect("second desktop wait approval after native list_apps");
    let once = next["options"]
        .as_array()
        .unwrap()
        .iter()
        .find(|option| option["kind"] == "once")
        .unwrap();
    sender
        .send(json!({"kind":"approval","id":next["id"],"option_id":once["id"]}))
        .await
        .unwrap();
    let owned = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let owned = descendants(worker_pid);
            if owned
                .iter()
                .any(|(_, name)| name.eq_ignore_ascii_case("cua-driver.exe"))
            {
                tokio::time::sleep(Duration::from_secs(1)).await;
                break descendants(worker_pid);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("owned native driver started");
    computer_activity::stop_all(&app);
    tokio::time::timeout(Duration::from_secs(10), task)
        .await
        .expect("shared takeover finishes without waiting 30 seconds")
        .unwrap();
    assert_eq!(session.lock().await.status, "stopped");
    let remaining = processes();
    assert!(!remaining.contains_key(&worker_pid));
    assert!(
        owned.iter().all(|(pid, _)| !remaining.contains_key(pid)),
        "an App Server or driver descendant survived: {owned:?}"
    );
    server.abort();
}
