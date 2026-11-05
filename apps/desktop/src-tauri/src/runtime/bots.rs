use super::{profile_scope::valid_profile_name, BackendState};
use crate::diagnostics::append_client_event;
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use std::{fs, path::Path};
use tauri::State;
use uuid::Uuid;

const BOT_CHAT_TITLE: &str = "Bot Chat";

fn bot_chat_create_params(request_id: &str) -> Value {
    json!({
        "source": "gui", "request_id": request_id,
        "title": BOT_CHAT_TITLE, "follow_profile_config": true
    })
}

fn profile_home(storage: &Path, profile: &str) -> Result<std::path::PathBuf, DesktopFailure> {
    if !valid_profile_name(profile) {
        return Err(DesktopFailure::invalid_input());
    }
    let root = storage.join("hermes-home");
    let home = if profile == "default" {
        root
    } else {
        root.join("profiles").join(profile)
    };
    let storage_root = fs::canonicalize(storage.join("hermes-home"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    let actual = fs::canonicalize(&home).map_err(|_| DesktopFailure::operation_failed())?;
    if !actual.starts_with(&storage_root) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(home)
}

// The canonical socket deliberately exposes roster reads but not profiles.configure. This
// marker lives only in the product-owned Hermes Home and enables the locked fork's Bot Chat
// protocol. Preserve every other profile.yaml key, including other clients' ui_meta keys.
fn enable_bot_mode(home: &Path, title: &str) -> Result<(), DesktopFailure> {
    let path = home.join("profile.yaml");
    if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(DesktopFailure::invalid_input());
    }
    let original = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => return Err(DesktopFailure::operation_failed()),
    };
    let mut document: serde_yaml::Mapping = if original.trim().is_empty() {
        serde_yaml::Mapping::new()
    } else {
        serde_yaml::from_str(&original).map_err(|_| DesktopFailure::operation_failed())?
    };
    let key = serde_yaml::Value::String("ui_meta".into());
    let mut meta = document
        .remove(&key)
        .and_then(|value| value.as_mapping().cloned())
        .unwrap_or_default();
    let marker = serde_yaml::Value::String("hermes-bots".into());
    if meta.get(&marker).is_some_and(serde_yaml::Value::is_mapping) {
        document.insert(key, serde_yaml::Value::Mapping(meta));
        return Ok(());
    }
    let mut bot = serde_yaml::Mapping::new();
    bot.insert(
        serde_yaml::Value::String("title".into()),
        serde_yaml::Value::String(title.into()),
    );
    meta.insert(marker, serde_yaml::Value::Mapping(bot));
    document.insert(key, serde_yaml::Value::Mapping(meta));
    let serialized =
        serde_yaml::to_string(&document).map_err(|_| DesktopFailure::operation_failed())?;
    let temporary = home.join(format!("profile.yaml.bot-mode-{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, serialized.as_bytes()).map_err(|_| DesktopFailure::operation_failed())?;
    let current = fs::read_to_string(&path).unwrap_or_default();
    if current != original {
        let _ = fs::remove_file(&temporary);
        return Err(DesktopFailure::conflict());
    }
    if fs::rename(&temporary, &path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(DesktopFailure::operation_failed());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_bots(state: State<'_, BackendState>) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile("default").await?;
    scope
        .gateway
        .request("profiles.list", json!({"include_sessions": true}))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn open_bot_chat(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let roster = scope
        .gateway
        .request("profiles.list", json!({"include_sessions": true}))
        .await?;
    let row = roster["profiles"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["name"] == profile))
        .ok_or_else(DesktopFailure::invalid_input)?;
    let title = row["display_name"]
        .as_str()
        .filter(|name| !name.is_empty())
        .unwrap_or(&profile);
    let home = profile_home(&scope.storage, &profile)?;
    let operation = Uuid::new_v4();
    let _ = append_client_event(
        &scope.storage,
        &format!("bot_chat operation={operation} profile={profile} result=started"),
    );
    if let Err(error) = enable_bot_mode(&home, title) {
        let _ = append_client_event(
            &scope.storage,
            &format!("ERROR bot_chat operation={operation} profile={profile} result=marker_failed"),
        );
        return Err(error);
    }
    let existing = row["canonical_session"]["resolved_id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .or_else(|| {
            row["canonical_session"]["id"]
                .as_str()
                .filter(|id| !id.is_empty())
        });
    let result: Result<Value, DesktopFailure> = if let Some(id) = existing {
        Ok(json!({"session_id": id, "created": false}))
    } else {
        let created = scope
            .gateway
            .request(
                "session.create",
                bot_chat_create_params(&Uuid::new_v4().to_string()),
            )
            .await;
        created.map_err(Into::into).and_then(|created: Value| {
            let id = created["session_id"]
                .as_str()
                .ok_or_else(DesktopFailure::operation_failed)?;
            Ok(json!({"session_id": id, "created": true}))
        })
    };
    match result {
        Ok(result) => {
            if let Err(error) = scope.ensure_current(&state).await {
                let _ = append_client_event(&scope.storage, &format!("ERROR bot_chat operation={operation} profile={profile} result=owner_changed"));
                return Err(error);
            }
            let _ = append_client_event(
                &scope.storage,
                &format!(
                    "bot_chat operation={operation} profile={profile} result=complete created={}",
                    result["created"].as_bool().unwrap_or(false)
                ),
            );
            Ok(result)
        }
        Err(error) => {
            let _ = append_client_event(
                &scope.storage,
                &format!(
                    "ERROR bot_chat operation={operation} profile={profile} result=create_failed"
                ),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn bot_groups_request(
    state: State<'_, BackendState>,
    profile: String,
    operation: String,
    params: Value,
) -> Result<Value, DesktopFailure> {
    let (method, params) = bot_group_request_shape(&operation, params)?;
    let scope = state.resolve_profile(&profile).await?;
    let operation_id = Uuid::new_v4();
    let traced = matches!(
        operation.as_str(),
        "create" | "send" | "stop" | "disband" | "approve"
    );
    if traced {
        let _ = append_client_event(&scope.storage, &format!("bot_group operation={operation_id} profile={profile} action={operation} result=started"));
    }
    match scope.gateway.request(method, params).await {
        Ok(result) => {
            if let Err(error) = scope.ensure_current(&state).await {
                if traced {
                    let _ = append_client_event(&scope.storage, &format!("ERROR bot_group operation={operation_id} profile={profile} action={operation} result=owner_changed"));
                }
                return Err(error);
            }
            if traced {
                let _ = append_client_event(&scope.storage, &format!("bot_group operation={operation_id} profile={profile} action={operation} result=complete"));
            }
            Ok(result)
        }
        Err(error) => {
            if traced {
                let _ = append_client_event(&scope.storage, &format!("ERROR bot_group operation={operation_id} profile={profile} action={operation} result=failed error={error}"));
            }
            Err(error.into())
        }
    }
}

fn bot_group_request_shape(
    operation: &str,
    params: Value,
) -> Result<(&'static str, Value), DesktopFailure> {
    let method = match operation {
        "capabilities" => "groups.capabilities",
        "list" => "groups.list",
        "state" => "groups.state",
        "log" => "groups.log",
        "create" => "groups.create",
        "send" => "groups.send",
        "stop" => "groups.stop",
        "disband" => "groups.disband",
        "approve" => "groups.approve",
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let mut params = params
        .as_object()
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)?;
    if params.contains_key("profile") {
        return Err(DesktopFailure::invalid_input());
    }
    if operation == "create" {
        if params
            .get("room_id")
            .and_then(Value::as_str)
            .is_none_or(|id| Uuid::parse_str(id).is_err())
        {
            return Err(DesktopFailure::invalid_input());
        }
    }
    if operation == "send" {
        let text = params
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(DesktopFailure::invalid_input)?;
        if text.trim().is_empty() || text.len() > 32 * 1024 {
            return Err(DesktopFailure::invalid_input());
        }
        let text = text.to_owned();
        let event_id = params
            .get("event_id")
            .and_then(Value::as_str)
            .filter(|id| Uuid::parse_str(id).is_ok())
            .ok_or_else(DesktopFailure::invalid_input)?
            .to_owned();
        let thread_id = params
            .get("thread_id")
            .and_then(Value::as_str)
            .filter(|id| Uuid::parse_str(id).is_ok())
            .ok_or_else(DesktopFailure::invalid_input)?
            .to_owned();
        params.remove("text");
        params.remove("thread_id");
        params.insert("event_id".into(), json!(event_id));
        params.insert(
            "payload".into(),
            json!({"thread_id": thread_id, "text": text}),
        );
    }
    Ok((method, Value::Object(params)))
}

#[cfg(test)]
#[path = "tests/bots.rs"]
mod tests;
