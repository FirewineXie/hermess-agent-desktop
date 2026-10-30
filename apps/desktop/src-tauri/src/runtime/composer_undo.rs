use crate::errors::DesktopFailure;
use crate::gateway::GatewayRequestError;
use serde_json::{json, Value};
use uuid::Uuid;

use super::profile_scope::ResolvedProfileScope;
use super::BackendState;

enum UndoArgument<'a> {
    Preview(usize),
    Apply(usize, &'a str),
}

fn parse_argument(arg: &str) -> Option<UndoArgument<'_>> {
    let words: Vec<&str> = arg.split_whitespace().collect();
    let turns = match words.first() {
        None => 1,
        Some(value) => value
            .parse::<usize>()
            .ok()
            .filter(|count| (1..=999).contains(count))?,
    };
    match words.as_slice() {
        [] | [_] => Some(UndoArgument::Preview(turns)),
        [_, "--confirm", token] if Uuid::parse_str(token).is_ok() => {
            Some(UndoArgument::Apply(turns, token))
        }
        _ => None,
    }
}

pub(super) fn valid_argument(arg: &str) -> bool {
    parse_argument(arg).is_some()
}

fn visible_text(row: &Value) -> String {
    let content = &row["content"];
    if let Some(value) = content.as_str() {
        return value.into();
    }
    if let Some(parts) = content.as_array() {
        return parts
            .iter()
            .filter_map(|part| part.as_str().or_else(|| part["text"].as_str()))
            .collect::<Vec<_>>()
            .join(" ");
    }
    row["text"].as_str().unwrap_or("").into()
}

fn is_user_turn(row: &Value) -> bool {
    if row["role"] != "user"
        || row["row_id"].as_u64().is_none_or(|id| id == 0)
        || row["archived"].as_bool() == Some(true)
    {
        return false;
    }
    if !matches!(row["display_kind"].as_str().unwrap_or(""), "" | "steer") {
        return false;
    }
    let text = visible_text(row);
    if row["_compressed_summary"].as_bool() == Some(true)
        || text.contains("--- END OF CONTEXT SUMMARY")
        || text.starts_with("[IMPORTANT: Background process ")
    {
        return false;
    }
    !text.trim().is_empty()
        || row["content"]
            .as_array()
            .is_some_and(|parts| !parts.is_empty())
        || row["content"].is_object()
}

fn preview(snapshot: &Value, turns: usize) -> Option<(u64, String)> {
    let rows = snapshot["messages"].as_array()?;
    let user_turns: Vec<&Value> = rows.iter().filter(|row| is_user_turn(row)).collect();
    if user_turns.len() < turns {
        return None;
    }
    let selected = &user_turns[user_turns.len() - turns..];
    let target = selected.first()?["row_id"].as_u64()?;
    let samples: Vec<String> = selected
        .iter()
        .take(3)
        .map(|row| {
            let plain = visible_text(row)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if plain.is_empty() {
                "[附件]".into()
            } else {
                plain.chars().take(80).collect()
            }
        })
        .collect();
    let suffix = if selected.len() > samples.len() {
        format!("，另有 {} 个回合", selected.len() - samples.len())
    } else {
        String::new()
    };
    Some((target, format!("{}{}", samples.join("；"), suffix)))
}

pub(super) async fn execute(
    state: &BackendState,
    scope: &ResolvedProfileScope,
    session_id: &str,
    arg: &str,
) -> Result<Value, DesktopFailure> {
    let action = parse_argument(arg).ok_or_else(DesktopFailure::invalid_input)?;
    let _gate = state.4.lock().await;
    let key = (
        scope.home.to_string_lossy().into_owned(),
        scope.profile.clone(),
        format!("undo:{session_id}"),
    );
    match action {
        UndoArgument::Preview(turns) => {
            if state
                .3
                .lock()
                .await
                .get(&key)
                .is_some_and(|row| row["sent"] == true)
            {
                return Err(DesktopFailure::timeout());
            }
            let snapshot = scope
                .gateway
                .request(
                    "session.resume",
                    json!({"session_id": session_id, "source": "desktop"}),
                )
                .await?;
            if snapshot["running"] == true {
                return Err(DesktopFailure::conflict());
            }
            let Some((target, sample)) = preview(&snapshot, turns) else {
                return Ok(json!({"type": "exec", "output": "当前会话没有足够的可回退用户回合。"}));
            };
            let (Some(revision), Some(generation)) = (
                snapshot["revision"].as_u64(),
                snapshot["execution_generation"].as_u64(),
            ) else {
                return Err(DesktopFailure::conflict());
            };
            let token = Uuid::new_v4().to_string();
            let params = json!({
                "session_id": session_id,
                "request_id": Uuid::new_v4().to_string(),
                "expected_revision": revision,
                "expected_generation": generation,
                "operation": "rewind",
                "payload": {"target_message_id": target},
            });
            let request_id = params["request_id"].as_str().unwrap_or("").to_owned();
            state.3.lock().await.insert(
                key,
                json!({
                    "token": token, "turns": turns, "params": params, "sent": false,
                }),
            );
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!("session_undo_prepared request={request_id} profile={} session={session_id} turns={turns} target={target}", scope.profile),
            );
            Ok(json!({
                "type": "prefill",
                "message": format!("/undo {turns} --confirm {token}"),
                "notice": format!("将回退最后 {turns} 个用户回合及其后续消息：{sample}。工作区文件不变。再次发送输入框中的确认命令执行；删除输入可取消。"),
            }))
        }
        UndoArgument::Apply(turns, token) => {
            let pending = state
                .3
                .lock()
                .await
                .get(&key)
                .cloned()
                .ok_or_else(DesktopFailure::conflict)?;
            if pending["token"] != token || pending["turns"] != turns {
                return Err(DesktopFailure::invalid_input());
            }
            let params = pending["params"].clone();
            if !pending["sent"].as_bool().unwrap_or(false) {
                state.3.lock().await.insert(
                    key.clone(),
                    json!({"token": token, "turns": turns, "params": params, "sent": true}),
                );
            }
            let request_id = params["request_id"].as_str().unwrap_or("").to_owned();
            let log = |stage: &str| {
                let _ = crate::diagnostics::append_client_event(
                    &scope.storage,
                    &format!("session_undo_{stage} request={request_id} profile={} session={session_id} turns={turns}", scope.profile),
                );
            };
            log("start");
            match scope
                .gateway
                .request_detailed("session.mutate", params)
                .await
            {
                Ok(receipt) => {
                    let Some(removed) =
                        receipt["rewound_count"].as_u64().filter(|count| *count > 0)
                    else {
                        log("invalid_receipt");
                        return Err(DesktopFailure::timeout());
                    };
                    state.3.lock().await.remove(&key);
                    log("completed");
                    Ok(
                        json!({"type": "exec", "display": "applied", "output": format!("已回退 {turns} 个用户回合；工作区文件未修改。网关移除了 {removed} 条活动消息。")}),
                    )
                }
                Err(GatewayRequestError::Rpc { message, code }) => {
                    state.3.lock().await.remove(&key);
                    log(&format!("refused code={code}"));
                    if matches!(
                        message.as_str(),
                        "revision_conflict"
                            | "stale_generation"
                            | "session_busy"
                            | "admission_conflict"
                    ) {
                        Err(DesktopFailure::conflict())
                    } else {
                        Err(DesktopFailure::operation_failed())
                    }
                }
                Err(GatewayRequestError::Transport(_)) => {
                    log("result_unknown");
                    Err(DesktopFailure::timeout())
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/composer_undo.rs"]
mod tests;
