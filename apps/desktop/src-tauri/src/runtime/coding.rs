use super::{
    coding_config::{self, CodingConfig, CodingConfigDraft},
    coding_worker,
};
use crate::{
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Manager, State};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
pub struct CodingMessage {
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<Value>,
}

#[cfg(all(test, windows))]
#[path = "tests/coding_archive.rs"]
mod archive_tests;
#[cfg(all(test, windows))]
#[path = "tests/coding.rs"]
mod tests;
#[derive(Clone, Deserialize, Serialize)]
pub struct CodingSession {
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub context: Option<Value>,
    pub id: String,
    pub title: String,
    pub cwd: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub config_id: String,
    pub model: String,
    pub thread_id: Option<String>,
    pub messages: Vec<CodingMessage>,
    pub status: String,
    pub output: String,
    pub error: String,
    pub activity: String,
    pub approval: Option<Value>,
}
pub(super) struct LiveSession {
    pub session: Arc<Mutex<CodingSession>>,
    pub control: mpsc::Sender<Value>,
}
#[derive(Default)]
pub struct CodingState {
    pub(super) gate: Mutex<()>,
    pub(super) live: Mutex<HashMap<String, LiveSession>>,
}

// Called after the shared manager has blocked new process creation.
pub(crate) async fn shutdown(app: &AppHandle) -> bool {
    let state = app.state::<CodingState>();
    let targets: Vec<_> = state
        .live
        .lock()
        .await
        .iter()
        .filter(|(_, live)| !live.control.is_closed())
        .map(|(id, live)| (id.clone(), live.control.clone()))
        .collect();
    if targets.is_empty() {
        return true;
    }
    let operation = Uuid::new_v4();
    coding_config::log(
        app,
        &format!(
            "programming_shutdown_start operation={operation} tasks={}",
            targets.len()
        ),
    );
    for (_, sender) in &targets {
        let _ = sender.try_send(json!({"kind":"stop"}));
    }
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        let pending = {
            let live = state.live.lock().await;
            targets
                .iter()
                .filter(|(id, _)| live.contains_key(id))
                .count()
        };
        if pending == 0 || tokio::time::Instant::now() >= deadline {
            coding_config::log(
                app,
                &format!(
                    "{}programming_shutdown_result operation={operation} pending={pending}",
                    if pending == 0 { "" } else { "ERROR " }
                ),
            );
            return pending == 0;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
}

pub fn start_config_audit(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        use sha2::{Digest, Sha256};
        let mut last = None;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let Ok(path) = coding_config::owned(&app, Path::new("config.toml")) else {
                continue;
            };
            let Ok(bytes) = fs::read(filesystem_path(&path)) else {
                continue;
            };
            let fingerprint: [u8; 32] = Sha256::digest(&bytes).into();
            if last == Some(fingerprint) {
                continue;
            }
            last = Some(fingerprint);
            let result = coding_config::ignored_fields(&app);
            let invalid = result.is_err();
            let restricted = result.is_ok_and(|fields| !fields.is_empty());
            coding_config::log(&app,
                &format!("{}programming_config_audit invalid={invalid} restricted_fields_ignored={restricted}", if invalid { "ERROR " } else { "" }));
        }
    });
}

pub(super) fn session_path(app: &AppHandle, id: &str) -> Result<PathBuf, DesktopFailure> {
    Uuid::parse_str(id).map_err(|_| DesktopFailure::invalid_input())?;
    coding_config::owned(app, &Path::new("sessions").join(format!("{id}.json")))
}
pub(super) fn persist(app: &AppHandle, session: &CodingSession) -> Result<(), DesktopFailure> {
    let path = session_path(app, &session.id)?;
    fs::create_dir_all(filesystem_path(path.parent().unwrap()))
        .map_err(|_| DesktopFailure::operation_failed())?;
    coding_config::write_json(&path, session)
}

fn approval_kind(
    session: &CodingSession,
    request_id: &str,
    option_id: &str,
) -> Result<String, DesktopFailure> {
    let approval = session
        .approval
        .as_ref()
        .ok_or_else(DesktopFailure::conflict)?;
    if session.status != "running" || approval["id"].as_str() != Some(request_id) {
        return Err(DesktopFailure::conflict());
    }
    approval["options"]
        .as_array()
        .and_then(|options| options.iter().find(|option| option["id"] == option_id))
        .and_then(|option| option["kind"].as_str())
        .map(str::to_owned)
        .ok_or_else(DesktopFailure::invalid_input)
}
async fn read(
    app: &AppHandle,
    state: &CodingState,
    id: &str,
) -> Result<CodingSession, DesktopFailure> {
    let live = state.live.lock().await;
    if let Some(active) = live.get(id) {
        return Ok(active.session.lock().await.clone());
    }
    let bytes = fs::read(filesystem_path(&session_path(app, id)?))
        .map_err(|_| "编程会话无法读取".to_string())?;
    let mut session: CodingSession =
        serde_json::from_slice(&bytes).map_err(|_| "编程会话数据无效".to_string())?;
    if session.id != id {
        return Err(DesktopFailure::invalid_input());
    }
    if session.status == "running" {
        session.status = "stopped".into();
        session.approval = None;
        session.error = "上次执行已结束，请确认项目状态后再继续".into();
    }
    Ok(session)
}

#[tauri::command]
pub async fn get_coding_config(app: AppHandle) -> Result<CodingConfig, DesktopFailure> {
    coding_config::read(&app)
}
#[tauri::command]
pub async fn save_coding_config(
    app: AppHandle,
    state: State<'_, CodingState>,
    draft: CodingConfigDraft,
) -> Result<CodingConfig, DesktopFailure> {
    let _guard = state.gate.lock().await;
    if state
        .live
        .lock()
        .await
        .values()
        .any(|s| !s.control.is_closed())
    {
        return Err("请先停止正在运行的编程任务，再修改全局配置".into());
    }
    let operation = Uuid::new_v4();
    coding_config::log(
        &app,
        &format!("programming_config_save_start operation={operation}"),
    );
    let result = coding_config::save(&app, draft).await;
    coding_config::log(
        &app,
        &format!(
            "{}programming_config_save_result operation={operation} success={}",
            if result.is_err() { "ERROR " } else { "" },
            result.is_ok()
        ),
    );
    result
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum CodingRequest {
    Command {
        id: String,
        command: Value,
        permissions: Option<String>,
        effort: Option<String>,
    },
    Answer {
        id: String,
        request_id: String,
        answers: Value,
    },
    Settings,
    ConfigFile,
    SaveConfigFile {
        revision: String,
        content: String,
    },
    SaveSettings {
        draft: super::coding_settings::Settings,
    },
    SettingsProbe {
        cwd: String,
        server: Option<String>,
        login: bool,
    },
    OpenSkillDirectory,
    ProjectInstruction {
        cwd: String,
        revision: Option<String>,
        content: Option<String>,
    },
    PermissionSettings,
    SavePermissionSettings {
        draft: super::coding_permission_settings::PermissionDraft,
    },
    OpenPermissionConfig,
    Permissions {
        cwd: String,
    },
    Skills {
        cwd: String,
    },
    Branch {
        cwd: String,
    },
    SwitchBranch {
        cwd: String,
        branch: String,
    },
    List,
    Projects,
    SaveProject {
        id: Option<String>,
        name: String,
        cwd: String,
    },
    Create {
        cwd: String,
        #[serde(default)]
        project_id: Option<String>,
        #[serde(default)]
        model_id: Option<String>,
    },
    Read {
        id: String,
    },
    Archive {
        id: String,
        archived: bool,
    },
    Send {
        id: String,
        text: String,
        #[serde(default)]
        images: Vec<String>,
        #[serde(default)]
        permissions: Option<String>,
        #[serde(default)]
        effort: Option<String>,
    },
    Stop {
        id: String,
    },
    Approve {
        id: String,
        request_id: String,
        option_id: String,
    },
    Remove {
        id: String,
    },
}

#[tauri::command]
pub async fn coding_session_request(
    app: AppHandle,
    state: State<'_, CodingState>,
    request: CodingRequest,
) -> Result<Value, DesktopFailure> {
    if let CodingRequest::SettingsProbe { cwd, server, login } = request {
        return super::coding_settings_probe::run(&app, cwd, server, login).await;
    }
    if let CodingRequest::Permissions { cwd } = request {
        return super::coding_permissions::list(&app, cwd).await;
    }
    if let CodingRequest::Skills { cwd } = request {
        return super::coding_permissions::skills(&app, cwd).await;
    }
    let mut run_command = None;
    let request = if let CodingRequest::Command {
        id,
        command,
        permissions,
        effort,
    } = request
    {
        super::coding_command::validate(&command)?;
        let live = state.live.lock().await;
        if let Some(active) = live.get(&id).filter(|active| !active.control.is_closed()) {
            if command["type"] != "goal"
                || !matches!(
                    command["action"].as_str(),
                    Some("pause" | "clear" | "get" | "update")
                )
            {
                return Err(DesktopFailure::conflict());
            }
            active
                .control
                .try_send(json!({"kind":"command", "command":command}))
                .map_err(|_| DesktopFailure::conflict())?;
            if command["action"] == "update" {
                coding_config::log(
                    &app,
                    &format!("programming_goal_edit_requested session={id}"),
                );
            }
            return Ok(Value::Null);
        }
        drop(live);
        if command["type"] == "plan" {
            let _guard = state.gate.lock().await;
            let mut session = read(&app, &state, &id).await?;
            if session.archived || session.status == "running" {
                return Err(DesktopFailure::conflict());
            }
            session.context.get_or_insert_with(|| json!({}))["mode"] = command["mode"].clone();
            persist(&app, &session)?;
            coding_config::log(
                &app,
                &format!(
                    "programming_mode session={id} mode={}",
                    command["mode"].as_str().unwrap_or("default")
                ),
            );
            if command["prompt"]
                .as_str()
                .is_none_or(|text| text.trim().is_empty())
            {
                return Ok(Value::Null);
            }
            CodingRequest::Send {
                id,
                text: command["prompt"].as_str().unwrap().into(),
                images: vec![],
                permissions,
                effort,
            }
        } else {
            let text = super::coding_command::display(&command);
            run_command = Some(command);
            CodingRequest::Send {
                id,
                text,
                images: vec![],
                permissions,
                effort,
            }
        }
    } else {
        request
    };
    let _guard = state.gate.lock().await;
    match request {
        CodingRequest::Command { .. } => unreachable!(),
        CodingRequest::Answer {
            id,
            request_id,
            answers,
        } => {
            let live = state.live.lock().await;
            let active = live.get(&id).ok_or_else(DesktopFailure::conflict)?;
            let snapshot = active.session.lock().await;
            if snapshot
                .context
                .as_ref()
                .is_none_or(|context| context["question"]["id"] != request_id)
                || !answers.is_object()
                || answers.to_string().len() > 64 * 1024
            {
                return Err(DesktopFailure::invalid_input());
            }
            active
                .control
                .try_send(json!({"kind":"answer", "id":request_id, "answers":answers}))
                .map_err(|_| DesktopFailure::conflict())?;
            Ok(Value::Null)
        }
        CodingRequest::Settings => Ok(json!(super::coding_settings::load(&app)?)),
        CodingRequest::ConfigFile => super::coding_settings_files::config(&app, None),
        CodingRequest::SaveConfigFile { revision, content } => {
            super::coding_settings_files::config(&app, Some((revision, content)))
        }
        CodingRequest::SaveSettings { draft } => {
            Ok(json!(super::coding_settings::save(&app, draft)?))
        }
        CodingRequest::OpenSkillDirectory => {
            super::coding_settings_files::open_skills(&app)?;
            Ok(Value::Null)
        }
        CodingRequest::ProjectInstruction {
            cwd,
            revision,
            content,
        } => super::coding_settings_files::instruction(&app, cwd, revision, content),
        CodingRequest::SettingsProbe { .. } => unreachable!(),
        CodingRequest::PermissionSettings => {
            Ok(json!(super::coding_permission_settings::read(&app)?))
        }
        CodingRequest::SavePermissionSettings { draft } => {
            Ok(json!(super::coding_permission_settings::save(&app, draft)?))
        }
        CodingRequest::OpenPermissionConfig => {
            super::coding_permissions::open_config(&app)?;
            Ok(Value::Null)
        }
        CodingRequest::Permissions { .. } => unreachable!(),
        CodingRequest::Skills { .. } => unreachable!(),
        CodingRequest::Branch { cwd } => {
            let cwd = super::chat_create::validate_workspace_path(Some(cwd))?
                .ok_or_else(DesktopFailure::operation_failed)?;
            let hooks = super::coding_context::hooks_directory(&app)?;
            Ok(json!(
                super::coding_context::read(Path::new(&cwd), &hooks).await?
            ))
        }
        CodingRequest::SwitchBranch { cwd, branch } => {
            let operation = Uuid::new_v4();
            coding_config::log(
                &app,
                &format!("programming_branch_switch_start operation={operation}"),
            );
            let result = async {
                let cwd = super::chat_create::validate_workspace_path(Some(cwd))?
                    .ok_or_else(DesktopFailure::invalid_input)?;
                let root = super::coding_context::repository(Path::new(&cwd));
                let live = state.live.lock().await;
                for active in live.values().filter(|active| !active.control.is_closed()) {
                    let snapshot = active.session.lock().await;
                    if root.is_some()
                        && super::coding_context::repository(Path::new(&snapshot.cwd)) == root
                    {
                        coding_config::log(&app, &format!("ERROR programming_branch_switch_blocked operation={operation} reason=running_task"));
                        return Err(DesktopFailure::conflict());
                    }
                }
                drop(live);
                let hooks = super::coding_context::hooks_directory(&app)?;
                super::coding_context::switch(Path::new(&cwd), &hooks, &branch).await
            }.await;
            let success = result.as_ref().is_ok_and(|git| git.switch_error.is_none());
            coding_config::log(
                &app,
                &format!(
                    "{}programming_branch_switch_result operation={operation} success={success}",
                    if success { "" } else { "ERROR " }
                ),
            );
            Ok(json!(result?))
        }
        CodingRequest::List => {
            let directory = coding_config::owned(&app, Path::new("sessions"))?;
            let mut rows = Vec::new();
            if filesystem_path(&directory).is_dir() {
                for entry in fs::read_dir(filesystem_path(&directory))
                    .map_err(|_| DesktopFailure::operation_failed())?
                {
                    let entry = entry.map_err(|_| DesktopFailure::operation_failed())?;
                    if entry.path().extension().is_some_and(|e| e == "json") {
                        if let Some(id) = entry.path().file_stem().and_then(|s| s.to_str()) {
                            let mut row = read(&app, &state, id).await?;
                            row.messages.clear();
                            row.output.clear();
                            row.approval = None;
                            rows.push(row);
                        }
                    }
                }
            }
            Ok(json!(rows))
        }
        CodingRequest::Projects => Ok(json!(super::coding_projects::list(&app)?)),
        CodingRequest::SaveProject { id, name, cwd } => {
            Ok(json!(super::coding_projects::save(&app, id, name, cwd)?))
        }
        CodingRequest::Create {
            cwd,
            project_id,
            model_id,
        } => {
            let config = if let Some(id) = model_id.as_deref() {
                super::coding_catalog::route(&app, Some(id))?.0
            } else {
                coding_config::read(&app)?
            };
            if !config.enabled || !config.has_key {
                return Err("请先启用并保存全局编程模型配置".into());
            }
            let cwd = if let Some(id) = &project_id {
                super::coding_projects::directory(&app, id)?
            } else {
                cwd
            };
            let cwd = super::chat_create::validate_workspace_path(Some(cwd))?
                .ok_or_else(DesktopFailure::invalid_input)?;
            let session = CodingSession {
                archived: false,
                id: Uuid::new_v4().to_string(),
                title: "新编程会话".into(),
                cwd,
                project_id,
                config_id: config.id,
                model: config.model,
                thread_id: None,
                messages: vec![],
                status: "idle".into(),
                output: String::new(),
                error: String::new(),
                activity: String::new(),
                approval: None,
                context: None,
            };
            persist(&app, &session)?;
            Ok(json!(session))
        }
        CodingRequest::Read { id } => Ok(json!(read(&app, &state, &id).await?)),
        CodingRequest::Archive { id, archived } => {
            let operation = Uuid::new_v4();
            coding_config::log(&app, &format!("programming_archive_start operation={operation} session={id} archived={archived}"));
            let result = async {
                if state.live.lock().await.contains_key(&id) {
                    return Err(DesktopFailure::conflict());
                }
                let mut session = read(&app, &state, &id).await?;
                session.archived = archived;
                persist(&app, &session)?;
                Ok(json!(session))
            }
            .await;
            coding_config::log(
                &app,
                &format!(
                    "{}programming_archive_result operation={operation} success={}",
                    if result.is_err() { "ERROR " } else { "" },
                    result.is_ok()
                ),
            );
            result
        }
        CodingRequest::Send {
            id,
            text,
            images,
            permissions,
            effort,
        } => {
            if effort
                .as_deref()
                .is_some_and(|value| !["low", "medium", "high", "xhigh"].contains(&value))
            {
                return Err(DesktopFailure::invalid_input());
            }
            let permissions = permissions.as_deref().unwrap_or("request");
            super::coding_permissions::validate(permissions)?;
            if state
                .live
                .lock()
                .await
                .get(&id)
                .is_some_and(|active| !active.control.is_closed())
            {
                return Err(DesktopFailure::conflict());
            }
            if (text.trim().is_empty() && images.is_empty()) || text.len() > 64 * 1024 {
                return Err(DesktopFailure::invalid_input());
            }
            let mut session = read(&app, &state, &id).await?;
            if session.archived {
                return Err("请先恢复已归档的编程会话".into());
            }
            if run_command.as_ref().is_some_and(|command| {
                command["type"] == "goal"
                    && matches!(command["action"].as_str(), Some("set" | "resume"))
            }) && session
                .context
                .as_ref()
                .is_some_and(|context| context["mode"] == "plan")
            {
                return Err("请先通过 /plan 切换到执行模式，再启动或恢复持续目标".into());
            }
            if session.status == "running" {
                return Err(DesktopFailure::conflict());
            }
            let (config, secret) = if super::coding_catalog::exists(&app)? {
                super::coding_catalog::route(&app, Some(&session.config_id))?
            } else {
                (coding_config::read(&app)?, coding_config::key(&app)?)
            };
            if !config.enabled || session.config_id != config.id {
                return Err("全局编程配置已变更，请新建编程会话".into());
            }
            if config.executable.is_empty() {
                return Err(DesktopFailure::runtime_unavailable());
            }
            let hermes = coding_worker::hermes_runtime(&app)?;
            let operation = Uuid::new_v4();
            coding_config::log(
                &app,
                &format!(
                    "programming_images_prepare_start operation={operation} count={}",
                    images.len()
                ),
            );
            let prepared = super::coding_images::prepare(images);
            coding_config::log(
                &app,
                &format!(
                    "{}programming_images_prepare_result operation={operation} success={}",
                    if prepared.is_err() { "ERROR " } else { "" },
                    prepared.is_ok()
                ),
            );
            let images = prepared?;
            let directory = coding_config::owned(&app, &Path::new("threads").join(&id))?;
            super::coding_vault::private_directory(&directory)?;
            // This generated file is an effective snapshot; user-facing configuration lives globally.
            let snapshot =
                coding_config::owned(&app, &Path::new("threads").join(&id).join("config.toml"))?;
            coding_config::write_bytes(&snapshot, b"")?;
            let mut command = coding_worker::command(&app, &hermes, &directory)?;
            let payload = json!({"integration":super::coding_settings::payload(&app)?, "home": plain_path(&directory), "private_root": coding_config::root(&app)?, "connection_id": config.id, "cwd": session.cwd, "model": config.model,
                "computer_tools_roots": coding_worker::product_tools_roots(&app, &hermes),
                "base_url": config.base_url, "effort": effort.unwrap_or(config.effort), "executable": config.executable,
                "api_key": secret, "thread_id": session.thread_id, "text": text, "images": images.data_urls, "permissions": permissions,
                "command":run_command, "mode":session.context.as_ref().and_then(|context| context["mode"].as_str()).unwrap_or("default")});
            let (child, registration) = crate::process_manager::spawn(&mut command, "programming")
                .map_err(|_| "编程运行时启动失败".to_string())?;
            if session.messages.is_empty() {
                session.title = if text.trim().is_empty() {
                    "图片编程任务".into()
                } else {
                    text.chars().take(36).collect()
                };
            }
            session.messages.push(CodingMessage {
                role: "user".into(),
                text,
                images: images.names,
                tool: None,
                timing: Some(json!({"started_at_ms": std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64})),
            });
            session.status = "running".into();
            session.context.get_or_insert_with(|| json!({}))["active_command"] = run_command
                .as_ref()
                .filter(|command| {
                    command["type"] != "goal"
                        || matches!(command["action"].as_str(), Some("set" | "resume"))
                })
                .map(|command| command["type"].clone())
                .unwrap_or(Value::Null);
            session.output.clear();
            session.error.clear();
            session.approval = None;
            if let Err(error) = persist(&app, &session) {
                let _ = registration.terminate_tree().await;
                return Err(error);
            }
            let session = Arc::new(Mutex::new(session));
            let (tx, rx) = mpsc::channel(8);
            state.live.lock().await.insert(
                id.clone(),
                LiveSession {
                    session: session.clone(),
                    control: tx.clone(),
                },
            );
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                coding_worker::run(app_clone, id, session, child, registration, payload, tx, rx)
                    .await;
            });
            Ok(json!(null))
        }
        CodingRequest::Stop { id } => {
            let live = state.live.lock().await;
            if let Some(active) = live.get(&id) {
                active
                    .control
                    .try_send(json!({"kind":"stop"}))
                    .map_err(|_| DesktopFailure::conflict())?;
            }
            Ok(json!(null))
        }
        CodingRequest::Approve {
            id,
            request_id,
            option_id,
        } => {
            let live = state.live.lock().await;
            let active = live.get(&id).ok_or_else(DesktopFailure::conflict)?;
            let mut session = active.session.lock().await;
            let kind = approval_kind(&session, &request_id, &option_id)?;
            active
                .control
                .try_send(json!({"kind":"approval", "id": request_id, "option_id":option_id}))
                .map_err(|_| DesktopFailure::conflict())?;
            coding_config::log(
                &app,
                &format!("programming_approval_answer session={id} kind={kind}"),
            );
            session.approval = None;
            Ok(json!(null))
        }
        CodingRequest::Remove { id } => {
            let operation = Uuid::new_v4();
            coding_config::log(
                &app,
                &format!("programming_delete_start operation={operation} session={id}"),
            );
            let result = async {
                if state
                    .live
                    .lock()
                    .await
                    .get(&id)
                    .is_some_and(|active| !active.control.is_closed())
                {
                    return Err(DesktopFailure::conflict());
                }
                if read(&app, &state, &id).await?.status == "running" {
                    return Err("请先停止编程会话".into());
                }
                fs::remove_file(filesystem_path(&session_path(&app, &id)?))
                    .map_err(|_| DesktopFailure::operation_failed())?;
                let directory = coding_config::owned(&app, &Path::new("threads").join(&id))?;
                if filesystem_path(&directory).is_dir() {
                    fs::remove_dir_all(filesystem_path(&directory))
                        .map_err(|_| "会话记录已删除，但编程运行数据清理失败".to_string())?;
                }
                state.live.lock().await.remove(&id);
                Ok(json!(null))
            }
            .await;
            coding_config::log(
                &app,
                &format!(
                    "{}programming_delete_result operation={operation} success={}",
                    if result.is_err() { "ERROR " } else { "" },
                    result.is_ok()
                ),
            );
            result
        }
    }
}
