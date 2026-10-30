use crate::errors::{DesktopFailure, SESSION_OWNER_UNKNOWN, SESSION_PROFILE_MISMATCH};
use crate::gateway::GatewayRequestError;
use serde_json::{json, Value};
use uuid::Uuid;

use super::profile_scope::ResolvedProfileScope;
use super::BackendState;

enum QueueAction<'a> {
    List,
    Add(&'a str),
    Edit(usize, &'a str),
    Remove(usize),
    Clear,
    Move,
}

fn parse(arg: &str) -> Option<QueueAction<'_>> {
    let arg = arg.trim();
    if arg.is_empty() || arg == "list" {
        return Some(QueueAction::List);
    }
    if arg == "clear" {
        return Some(QueueAction::Clear);
    }
    let (verb, rest) = arg.split_once(char::is_whitespace).unwrap_or((arg, ""));
    let rest = rest.trim();
    match verb {
        "move" => Some(QueueAction::Move),
        "add" if !rest.is_empty() => Some(QueueAction::Add(rest)),
        "edit" => {
            let (index, text) = rest.split_once(char::is_whitespace)?;
            let index = index.parse::<usize>().ok().filter(|value| *value > 0)?;
            (!text.trim().is_empty()).then_some(QueueAction::Edit(index, text.trim()))
        }
        "rm" => rest
            .parse::<usize>()
            .ok()
            .filter(|value| *value > 0)
            .map(QueueAction::Remove),
        _ => None,
    }
}

pub(super) fn valid_argument(arg: &str) -> bool {
    parse(arg).is_some()
}

fn queued(snapshot: &Value) -> Vec<&Value> {
    let mut rows: Vec<&Value> = snapshot["pending"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| {
            row["status"] == "queued"
                && row["admission_id"].as_str().is_some()
                && row["controls"]
                    .as_array()
                    .is_some_and(|controls| controls.iter().any(|item| item == "replace"))
        })
        .collect();
    rows.sort_by_key(|row| row["sequence"].as_u64().unwrap_or(u64::MAX));
    rows
}

fn list_output(rows: &[&Value]) -> String {
    if rows.is_empty() {
        return "当前会话没有可管理的排队请求。".into();
    }
    let mut lines = vec![format!("当前会话有 {} 条可管理的排队请求：", rows.len())];
    for (index, row) in rows.iter().enumerate() {
        let text = row["text"]
            .as_str()
            .unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let excerpt: String = text.chars().take(120).collect();
        lines.push(format!(
            "{}. {}{}",
            index + 1,
            excerpt,
            if text.chars().count() > 120 {
                "…"
            } else {
                ""
            }
        ));
    }
    lines.join("\n")
}

fn mutation_output(action: &QueueAction<'_>, receipt: &Value) -> Result<String, DesktopFailure> {
    match action {
        QueueAction::Add(_) => match receipt["status"].as_str() {
            Some("queued") => Ok("请求已加入当前会话的持久化队列。".into()),
            Some("running" | "completed") => Ok("请求已由网关接收并开始执行。".into()),
            _ => Err(DesktopFailure::operation_failed()),
        },
        QueueAction::Edit(index, _) => {
            if receipt["admission_id"].as_str().is_none() {
                return Err(DesktopFailure::operation_failed());
            }
            Ok(format!("第 {index} 条请求已更新，并移至队尾。"))
        }
        QueueAction::Remove(index) => Ok(
            match (receipt["status"].as_str(), receipt["outcome"].as_str()) {
                (Some("terminal"), Some("cancelled")) => format!("第 {index} 条排队请求已删除。"),
                (Some("started"), _) | (_, Some("interrupted")) => {
                    format!("第 {index} 条请求已开始，网关已请求停止该回合。")
                }
                _ => format!("第 {index} 条请求已开始或完成，未从队列删除。"),
            },
        ),
        QueueAction::Clear => Ok(
            "上一条清空操作的结果已确认；请用 /queue list 检查剩余队列，再执行 /queue clear。"
                .into(),
        ),
        _ => Err(DesktopFailure::invalid_input()),
    }
}

async fn request_mutation(
    state: &BackendState,
    scope: &ResolvedProfileScope,
    key: (String, String, String),
    command: &str,
    method: &'static str,
    params: Value,
) -> Result<Value, DesktopFailure> {
    let existing = state.3.lock().await.get(&key).cloned();
    let (method, params) = if let Some(pending) = existing {
        if pending["command"] != command {
            return Err(DesktopFailure::timeout());
        }
        let saved_method = pending["method"]
            .as_str()
            .ok_or_else(DesktopFailure::operation_failed)?;
        let saved_method = match saved_method {
            "prompt.submit" => "prompt.submit",
            "prompt.replace_queued" => "prompt.replace_queued",
            "prompt.cancel" => "prompt.cancel",
            _ => return Err(DesktopFailure::operation_failed()),
        };
        (saved_method, pending["params"].clone())
    } else {
        state.3.lock().await.insert(
            key.clone(),
            json!({"command": command, "method": method, "params": params}),
        );
        (method, params)
    };
    let result = scope.gateway.request_detailed(method, params).await;
    match result {
        Ok(value) => {
            state.3.lock().await.remove(&key);
            Ok(value)
        }
        Err(GatewayRequestError::Transport(message))
            if matches!(
                message.as_str(),
                SESSION_OWNER_UNKNOWN | SESSION_PROFILE_MISMATCH
            ) =>
        {
            state.3.lock().await.remove(&key);
            Err(message.into())
        }
        Err(GatewayRequestError::Transport(_)) => Err(DesktopFailure::timeout()),
        Err(GatewayRequestError::Rpc { message, .. }) => {
            state.3.lock().await.remove(&key);
            if matches!(
                message.as_str(),
                "admission_started" | "stale_generation" | "session_busy"
            ) {
                Err(DesktopFailure::conflict())
            } else {
                Err(DesktopFailure::operation_failed())
            }
        }
    }
}

pub(super) async fn execute(
    state: &BackendState,
    scope: &ResolvedProfileScope,
    session_id: &str,
    arg: &str,
) -> Result<Value, DesktopFailure> {
    let action = parse(arg).ok_or_else(DesktopFailure::invalid_input)?;
    if matches!(action, QueueAction::Move) {
        return Ok(
            json!({"type": "exec", "output": "当前 Gateway 的持久化队列按提交顺序执行，不支持重排；可删除后重新入队。"}),
        );
    }
    let _gate = state.4.lock().await;
    let operation = Uuid::new_v4();
    let log = |stage: &str| {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "session_queue_{stage} operation={operation} profile={} session={session_id}",
                scope.profile
            ),
        );
    };
    log("start");
    let result = async {
        let key = (scope.home.to_string_lossy().into_owned(), scope.profile.clone(), format!("queue:{session_id}"));
        if !matches!(action, QueueAction::List) {
            if let Some(pending) = state.3.lock().await.get(&key).cloned() {
                if pending["command"] != arg { return Err(DesktopFailure::timeout()); }
                let receipt = request_mutation(state, scope, key.clone(), arg, "prompt.cancel", json!({})).await?;
                return Ok(json!({"type": "exec", "output": mutation_output(&action, &receipt)?}));
            }
        }
        let snapshot = scope.gateway.request(
            "session.resume",
            json!({"session_id": session_id, "source": "desktop", "defer_history": true, "omit_messages": true}),
        ).await?;
        let rows = queued(&snapshot);
        let output = match action {
            QueueAction::List => list_output(&rows),
            QueueAction::Add(text) => {
                if snapshot["running"] != true { return Err(DesktopFailure::conflict()); }
                let params = json!({"session_id": session_id, "text": text, "queued": true, "submission_id": Uuid::new_v4().to_string()});
                let receipt = request_mutation(state, scope, key, arg, "prompt.submit", params).await?;
                mutation_output(&QueueAction::Add(text), &receipt)?
            }
            QueueAction::Edit(index, text) => {
                let row = rows.get(index - 1).ok_or_else(DesktopFailure::invalid_input)?;
                let admission = row["admission_id"].as_str().ok_or_else(DesktopFailure::operation_failed)?;
                let params = json!({"session_id": session_id, "admission_id": admission, "submission_id": Uuid::new_v4().to_string(), "text": text});
                let receipt = request_mutation(state, scope, key, arg, "prompt.replace_queued", params).await?;
                mutation_output(&QueueAction::Edit(index, text), &receipt)?
            }
            QueueAction::Remove(index) => {
                let row = rows.get(index - 1).ok_or_else(DesktopFailure::invalid_input)?;
                let admission = row["admission_id"].as_str().ok_or_else(DesktopFailure::operation_failed)?;
                let receipt = request_mutation(state, scope, key, arg, "prompt.cancel", json!({"session_id": session_id, "admission_id": admission})).await?;
                mutation_output(&QueueAction::Remove(index), &receipt)?
            }
            QueueAction::Clear => {
                let mut cancelled = 0usize;
                let mut started = 0usize;
                for row in rows {
                    let admission = row["admission_id"].as_str().ok_or_else(DesktopFailure::operation_failed)?;
                    let receipt = request_mutation(state, scope, key.clone(), arg, "prompt.cancel", json!({"session_id": session_id, "admission_id": admission})).await?;
                    if receipt["status"] == "terminal" && receipt["outcome"] == "cancelled" { cancelled += 1; }
                    else { started += 1; }
                }
                format!("已删除 {cancelled} 条排队请求；{started} 条已开始或完成，不能作为排队项删除。")
            }
            QueueAction::Move => unreachable!(),
        };
        Ok(json!({"type": "exec", "output": output}))
    }.await;
    if let Err(error) = &result {
        let code = serde_json::to_value(error)
            .ok()
            .and_then(|value| value["code"].as_str().map(str::to_owned))
            .unwrap_or_default();
        log(&format!("failed code={code}"));
    } else {
        log("completed");
    }
    result
}

#[cfg(test)]
#[path = "tests/composer_queue.rs"]
mod tests;
