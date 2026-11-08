use super::{
    coding::{self, CodingMessage, CodingSession},
    coding_config, helper_python,
};
use crate::{
    errors::DesktopFailure,
    paths::{plain_path, CanonicalizePlain},
    process_manager::ProcessRegistration,
};
use base64::Engine;
use serde_json::Value;
use std::io::Write;
use std::{path::Path, process::Stdio, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{mpsc, Mutex},
};

const WORKER: &str = concat!(
    include_str!("../../../runtime/programming_session_commands.py"),
    "\n",
    include_str!("../../../runtime/programming_worker.py")
);
const MAX_EVENT_BYTES: usize = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

// Keep partial frames across select cancellation, and reject oversized frames before allocating them.
pub(super) async fn read_event<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    pending: &mut Vec<u8>,
) -> Result<Option<Value>, ()> {
    loop {
        let available = reader.fill_buf().await.map_err(|_| ())?;
        if available.is_empty() {
            return if pending.is_empty() {
                Ok(None)
            } else {
                Err(())
            };
        }
        let end = available.iter().position(|byte| *byte == b'\n');
        let count = end.map_or(available.len(), |index| index + 1);
        if pending.len() + count > MAX_EVENT_BYTES {
            return Err(());
        }
        pending.extend_from_slice(&available[..count]);
        reader.consume(count);
        if end.is_some() {
            let parsed = serde_json::from_slice(pending).map_err(|_| ());
            pending.clear();
            return parsed.map(Some);
        }
    }
}

fn bounded_text(text: &str, limit: usize) -> &str {
    let mut end = text.len().min(limit);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

pub(super) fn hermes_runtime(app: &AppHandle) -> Result<std::path::PathBuf, DesktopFailure> {
    if cfg!(debug_assertions) {
        let python = super::dev_backend_defaults()?.python_path;
        let python = Path::new(&python);
        let binary = python
            .parent()
            .ok_or_else(DesktopFailure::runtime_unavailable)?
            .join(if cfg!(windows) {
                "hermes.exe"
            } else {
                "hermes"
            });
        if !binary.is_file() {
            return Err(DesktopFailure::runtime_unavailable());
        }
        return Ok(plain_path(&binary));
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|_| DesktopFailure::runtime_unavailable())?;
    super::payload::validate_payload(&plain_path(&resource).join("runtime/payload"))
        .map_err(Into::into)
}

pub(super) fn computer_tools_roots(app: &AppHandle, hermes: &Path) -> Vec<std::path::PathBuf> {
    let mut roots = Vec::new();
    if let Some(storage) = super::existing_client_log_storage(app) {
        roots.push(plain_path(&storage.join("hermes-home/tools")));
    }
    if let Some(payload) = hermes
        .parent()
        .and_then(Path::parent)
        .filter(|root| root.join("manifest.json").is_file())
    {
        roots.push(plain_path(&payload.join("tools")));
    }
    roots
}

fn worker_bootstrap() -> Result<String, DesktopFailure> {
    // Windows CreateProcess has a 32,767 UTF-16 command-line limit. Keep the embedded
    // source immutable and pass a small stdlib-only bootstrap to both runtime layouts.
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    encoder
        .write_all(WORKER.as_bytes())
        .map_err(|_| DesktopFailure::operation_failed())?;
    let source = base64::engine::general_purpose::STANDARD.encode(
        encoder
            .finish()
            .map_err(|_| DesktopFailure::operation_failed())?,
    );
    let bootstrap = format!("import base64,zlib;exec(compile(zlib.decompress(base64.b64decode('{source}')),'<hermess-programming-worker>','exec'))");
    Ok(bootstrap)
}

pub(super) fn command(hermes: &Path, home: &Path) -> Result<Command, DesktopFailure> {
    let mut command = helper_python::command(hermes, &worker_bootstrap()?)?;
    // Preserve only the helper's explicitly constructed Python import path plus OS execution essentials.
    let python_path = command
        .as_std()
        .get_envs()
        .find(|(key, _)| *key == "PYTHONPATH")
        .and_then(|(_, value)| value.map(|v| v.to_owned()));
    command.env_clear();
    for name in [
        "PATH",
        "SystemRoot",
        "SystemDrive",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "HOME",
        "USERPROFILE",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    if let Some(path) = python_path {
        command.env("PYTHONPATH", path);
    }
    if cfg!(debug_assertions)
        && command
            .as_std()
            .get_envs()
            .all(|(key, _)| key != "PYTHONPATH")
    {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../upstream/hermes-agent")
            .canonicalize_plain()
            .map_err(|_| "无法定位锁定编程运行时源码".to_string())?;
        command.env("PYTHONPATH", plain_path(&repo));
    }
    command
        .current_dir(home)
        .env("CODEX_HOME", home)
        .env("HERMES_HOME", home)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    Ok(command)
}

fn flush_message(session: &mut CodingSession) {
    if !session.output.is_empty() {
        session.messages.push(CodingMessage {
            role: "assistant".into(),
            text: std::mem::take(&mut session.output),
            images: vec![],
            tool: None,
            timing: None,
        });
    }
}

fn apply_event(session: &mut CodingSession, event: Value) -> bool {
    match event["kind"].as_str() {
        Some("goal") => {
            session.context.get_or_insert_with(|| serde_json::json!({}))["goal"] =
                event["goal"].clone()
        }
        Some("question") => {
            session.context.get_or_insert_with(|| serde_json::json!({}))["question"] = event
        }
        Some("question_closed") => {
            if let Some(context) = session.context.as_mut() {
                context["question"] = Value::Null;
            }
        }
        Some("delta") => {
            if session.output.len() < MAX_OUTPUT_BYTES {
                session.output.push_str(bounded_text(
                    event["text"].as_str().unwrap_or(""),
                    MAX_OUTPUT_BYTES - session.output.len(),
                ));
            }
        }
        Some("thread") => session.thread_id = event["id"].as_str().map(str::to_owned),
        Some("message") => {
            if let Some(text) = event["text"].as_str().filter(|text| !text.is_empty()) {
                session.output = bounded_text(text, MAX_OUTPUT_BYTES).to_owned();
            }
            flush_message(session);
        }
        Some("tool") => {
            flush_message(session);
            let tool = &event["tool"];
            if let Some(id) = tool["id"].as_str().filter(|id| !id.is_empty()) {
                let existing = session
                    .messages
                    .iter_mut()
                    .rev()
                    .take_while(|message| message.role != "user")
                    .find(|message| message.tool.as_ref().is_some_and(|value| value["id"] == id));
                if let Some(message) = existing {
                    message.tool = Some(tool.clone());
                } else {
                    session.messages.push(CodingMessage {
                        role: "assistant".into(),
                        text: String::new(),
                        images: vec![],
                        tool: Some(tool.clone()),
                        timing: None,
                    });
                }
            }
            session.activity.clear();
        }
        Some("tool_delta") => {
            if let Some(tool) = session
                .messages
                .iter_mut()
                .rev()
                .take_while(|message| message.role != "user")
                .filter_map(|message| message.tool.as_mut())
                .find(|tool| tool["id"] == event["id"])
            {
                let output = tool["output"].as_str().unwrap_or("");
                let remaining = (64 * 1024usize).saturating_sub(output.len());
                tool["output"] = Value::String(format!(
                    "{}{}",
                    output,
                    bounded_text(event["text"].as_str().unwrap_or(""), remaining)
                ));
            }
        }
        Some("activity") => session.activity = event["text"].as_str().unwrap_or("").to_owned(),
        Some("approval") => session.approval = Some(event),
        Some("approval_closed") => {
            if session
                .approval
                .as_ref()
                .is_some_and(|approval| approval["id"] == event["id"])
            {
                session.approval = None;
            }
        }
        Some("context") => {
            let context = session.context.get_or_insert_with(|| serde_json::json!({}));
            for key in [
                "effort",
                "approval_policy",
                "approvals_reviewer",
                "permissions",
                "used_tokens",
                "context_window",
            ] {
                if let Some(value) = event.get(key) {
                    context[key] = value.clone();
                }
            }
        }
        Some("result") => {
            session.status = if event["interrupted"] == true {
                "stopped"
            } else if event["failed"] == true {
                "failed"
            } else {
                "completed"
            }
            .into();
            if event["failed"] == true {
                session.error = match event["reason"].as_str() {
                    Some("question_timeout") => "等待澄清回答超时，任务已停止",
                    Some("goal_state_unconfirmed") => {
                        "目标执行中断，且无法确认原生目标状态；请先刷新或暂停目标后继续"
                    }
                    Some("sandbox_unavailable") => {
                        "当前机器的编程沙箱不可用，任务已停止；不会切换为无隔离执行"
                    }
                    Some("authentication_failed") => "代理认证失败，请在编程设置中检查 API Key",
                    Some("responses_unavailable") => {
                        "代理未接受 Responses 请求，请检查基础地址和端点支持"
                    }
                    Some("resume_failed") => "原编程线程恢复失败，未创建空线程或重发任务",
                    Some("configuration_rejected") => {
                        "运行配置未通过模型控制或隔离检查，任务已停止"
                    }
                    _ => "编程请求失败，请检查运行时、代理与模型兼容性",
                }
                .into();
            }
            if let Some(text) = event["text"].as_str().filter(|v| !v.is_empty()) {
                let last = session
                    .messages
                    .iter()
                    .rev()
                    .take_while(|message| message.role != "user")
                    .find(|message| message.tool.is_none());
                if last.is_none_or(|message| message.text != text) {
                    session.output = bounded_text(text, MAX_OUTPUT_BYTES).to_owned();
                }
            }
            return true;
        }
        _ => {}
    }
    false
}

pub(super) async fn run(
    app: AppHandle,
    id: String,
    session: Arc<Mutex<CodingSession>>,
    mut child: Child,
    registration: ProcessRegistration,
    payload: Value,
    activity_control: mpsc::Sender<Value>,
    mut control: mpsc::Receiver<Value>,
) {
    let started = std::time::Instant::now();
    coding_config::log(
        &app,
        &format!(
            "programming_turn_start session={id} effort={} permissions={} command={} mode={}",
            payload["effort"].as_str().unwrap_or("unknown"),
            payload["permissions"].as_str().unwrap_or("hermess"),
            payload["command"]["type"].as_str().unwrap_or("message"),
            payload["mode"].as_str().unwrap_or("default")
        ),
    );
    let mut completed = false;
    let activity_connection = uuid::Uuid::new_v4().to_string();
    let activity_key = crate::computer_activity::Key {
        connection: activity_connection.clone(),
        session: id.clone(),
        generation: 0,
    };
    let mut terminal_status = None;
    let mut stopped = false;
    let long_goal = payload["command"]["type"] == "goal"
        && matches!(
            payload["command"]["action"].as_str(),
            Some("set" | "resume")
        );
    let mut last_goal_status = None;
    let result: Result<(), ()> = async {
        let mut input = child.stdin.take().ok_or(())?;
        let output = child.stdout.take().ok_or(())?;
        let mut reader = BufReader::new(output);
        let mut bytes = Vec::new();
        let mut initial = serde_json::to_vec(&payload).map_err(|_| ())?;
        initial.push(b'\n');
        tokio::time::timeout(Duration::from_secs(30), input.write_all(&initial))
            .await
            .map_err(|_| ())?
            .map_err(|_| ())?;
        drop(initial);
        drop(payload);
        let deadline = tokio::time::sleep(Duration::from_secs(1830));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                _ = &mut deadline, if !long_goal || stopped => { return Err(()); }
                message = control.recv() => {
                    let Some(message) = message else { return Err(()); };
                    if message["kind"] == "stop" {
                        stopped = true;
                        deadline.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(8));
                    }
                    let mut wire = serde_json::to_vec(&message).map_err(|_| ())?; wire.push(b'\n');
                    input.write_all(&wire).await.map_err(|_| ())?;
                }
                event = read_event(&mut reader, &mut bytes) => {
                    let event = event?.ok_or(())?;
                    if event["kind"] == "computer_result" {
                        coding_config::log(&app, &format!("{}programming_computer_result operation={} call={} outcome={}",
                            if event["outcome"] == "completed" { "" } else { "ERROR " }, activity_connection,
                            event["tool_id"].as_str().unwrap_or(""), event["outcome"].as_str().unwrap_or("unknown")));
                        continue;
                    }
                    if event["kind"] == "computer_activity" {
                        if let Some(tool) = event["tool_id"].as_str().filter(|tool| !tool.is_empty()) {
                            if event["started"] == true {
                                crate::computer_activity::start(&app, activity_key.clone(), tool,
                                    crate::computer_activity::Stop::Codex(activity_control.clone()));
                            } else {
                                crate::computer_activity::tool_finished(&app, &activity_key, tool);
                            }
                        }
                        continue;
                    }
                    let mut snapshot = session.lock().await;
                    let is_thread = event["kind"] == "thread";
                    let is_goal = event["kind"] == "goal";
                    if is_goal {
                        if event["operation"] == "update" { coding_config::log(&app, &format!("programming_goal_edit_result session={id} outcome=accepted")); }
                        let status = event["goal"]["status"].as_str().unwrap_or("cleared").to_owned();
                        if last_goal_status.as_ref() != Some(&status) {
                            coding_config::log(&app, &format!("programming_goal session={id} status={status}"));
                            last_goal_status = Some(status);
                        }
                    }
                    if matches!(event["kind"].as_str(), Some("tool" | "approval" | "approval_closed")) {
                        coding_config::log(&app, &format!("{}programming_event session={id} kind={} tool={} status={} outcome={}",
                            if event["outcome"] == "timeout" { "ERROR " } else { "" },
                            event["kind"].as_str().unwrap_or(""), event["tool"]["type"].as_str().unwrap_or(""), event["tool"]["status"].as_str().unwrap_or(""), event["outcome"].as_str().unwrap_or("")));
                    }
                    completed = apply_event(&mut snapshot, event);
                    if completed { terminal_status = Some(std::mem::replace(&mut snapshot.status, "running".into())); }
                    if is_thread || is_goal { coding::persist(&app, &snapshot).map_err(|_| ())?; }
                    if completed { break; }
                }
            }
        }
        Ok(())
    }
    .await;
    if completed {
        let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
    }
    let cleanup = registration.terminate_tree().await;
    let _ = child.wait().await;
    crate::computer_activity::process_finished(&app, &activity_connection, cleanup.is_ok());
    let mut snapshot = session.lock().await;
    snapshot.approval = None;
    if let Some(context) = snapshot.context.as_mut() {
        context["question"] = Value::Null;
        context["active_command"] = Value::Null;
    }
    snapshot.activity.clear();
    if stopped {
        snapshot.status = "stopped".into();
    } else if result.is_err() || !completed || cleanup.is_err() {
        snapshot.status = "failed".into();
        snapshot.error = "编程运行中断、超时或进程清理失败，请检查后重试".into();
    } else if let Some(status) = terminal_status {
        snapshot.status = status;
    }
    for tool in snapshot
        .messages
        .iter_mut()
        .rev()
        .take_while(|message| message.role != "user")
        .filter_map(|message| message.tool.as_mut())
    {
        if tool["status"] == "inProgress" {
            tool["status"] = Value::String("interrupted".into());
        }
    }
    flush_message(&mut snapshot);
    if let Some(timing) = snapshot
        .messages
        .iter_mut()
        .rev()
        .find(|message| message.role == "user")
        .and_then(|message| message.timing.as_mut())
    {
        timing["elapsed_ms"] = serde_json::json!(started.elapsed().as_millis() as u64);
    }
    let persisted = coding::persist(&app, &snapshot).is_ok();
    if !persisted {
        snapshot.status = "failed".into();
        snapshot.error = "执行已结束，但会话保存失败，请勿重复执行".into();
    }
    coding_config::log(
        &app,
        &format!(
            "{}programming_turn_result session={id} status={} cleanup={} elapsed_ms={}",
            if snapshot.status == "failed" {
                "ERROR "
            } else {
                ""
            },
            snapshot.status,
            cleanup.is_ok(),
            started.elapsed().as_millis()
        ),
    );
    drop(snapshot);
    if persisted {
        let state = app.state::<coding::CodingState>();
        let mut live = state.live.lock().await;
        if live
            .get(&id)
            .is_some_and(|active| Arc::ptr_eq(&active.session, &session))
        {
            live.remove(&id);
        }
    }
}

#[cfg(test)]
#[path = "tests/coding_worker.rs"]
mod tests;

#[cfg(all(test, windows))]
#[path = "tests/coding_computer.rs"]
mod computer_tests;
