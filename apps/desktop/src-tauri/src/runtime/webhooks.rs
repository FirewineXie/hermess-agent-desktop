use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use crate::paths::filesystem_path;
use reqwest::Method;
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};
use tauri::State;
use uuid::Uuid;

const SUBSCRIPTIONS: &str = "webhook_subscriptions.json";
const SUBSCRIPTIONS_LOCK: &str = ".webhook_subscriptions.lock";

fn read_shared(home: &Path) -> Result<serde_json::Map<String, Value>, DesktopFailure> {
    let path = home.join(SUBSCRIPTIONS);
    let bytes = match fs::read(filesystem_path(&path)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Default::default()),
        Err(_) => return Err(DesktopFailure::operation_failed()),
    };
    if bytes.len() > 1024 * 1024 {
        return Err(DesktopFailure::operation_failed());
    }
    let text = String::from_utf8(bytes).map_err(|_| DesktopFailure::operation_failed())?;
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| DesktopFailure::operation_failed())?;
    value
        .as_object()
        .cloned()
        .ok_or_else(DesktopFailure::operation_failed)
}

fn shared_mutation<T>(
    home: &Path,
    change: impl FnOnce(&mut serde_json::Map<String, Value>) -> Result<T, DesktopFailure>,
) -> Result<T, DesktopFailure> {
    let lock_path = home.join(SUBSCRIPTIONS_LOCK);
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(filesystem_path(&lock_path))
        .map_err(|_| DesktopFailure::operation_failed())?;
    lock.lock()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut routes = read_shared(home)?;
    let result = change(&mut routes)?;
    let path = home.join(SUBSCRIPTIONS);
    let mut staged = tempfile::NamedTempFile::new_in(filesystem_path(home))
        .map_err(|_| DesktopFailure::operation_failed())?;
    #[cfg(unix)]
    staged
        .as_file()
        .set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))
        .map_err(|_| DesktopFailure::operation_failed())?;
    serde_json::to_writer(&mut staged, &routes).map_err(|_| DesktopFailure::operation_failed())?;
    staged
        .flush()
        .map_err(|_| DesktopFailure::operation_failed())?;
    staged
        .as_file()
        .sync_all()
        .map_err(|_| DesktopFailure::operation_failed())?;
    staged
        .persist(filesystem_path(&path))
        .map_err(|_| DesktopFailure::operation_failed())?;
    Ok(result)
}

fn route_summary(name: &str, route: &Value, base: &str, profile: &str) -> Value {
    let prefix = if profile == "default" {
        String::new()
    } else {
        format!("/p/{profile}")
    };
    json!({
        "name": name, "description": route.get("description").cloned().unwrap_or(json!("")),
        "events": route.get("events").cloned().unwrap_or(json!([])),
        "deliver": route.get("deliver").cloned().unwrap_or(json!("log")),
        "deliver_only": route.get("deliver_only") == Some(&json!(true)),
        "prompt": route.get("prompt").cloned().unwrap_or(json!("")),
        "created_at": route.get("created_at").cloned().unwrap_or(Value::Null),
        "url": format!("{base}{prefix}/webhooks/{name}"),
        "secret_set": route.get("secret").and_then(Value::as_str).is_some_and(|s| !s.is_empty()),
        "enabled": route.get("enabled") != Some(&json!(false)),
    })
}

fn named_request(
    home: &Path,
    profile: &str,
    operation: &str,
    payload: &Value,
    base: &str,
) -> Result<Value, DesktopFailure> {
    if operation == "webhooks.list" {
        let subscriptions = read_shared(home)?
            .into_iter()
            .filter(|(_, route)| {
                route
                    .get("profile")
                    .and_then(Value::as_str)
                    .unwrap_or("default")
                    == profile
            })
            .map(|(name, route)| route_summary(&name, &route, base, profile))
            .collect::<Vec<_>>();
        return Ok(json!({"enabled": true, "base_url": base, "subscriptions": subscriptions}));
    }
    let route_name = name(payload)?.to_owned();
    shared_mutation(home, |routes| match operation {
        "webhooks.create" => {
            let body = creation_body(payload)?;
            if routes.contains_key(&route_name) {
                return Err(DesktopFailure::conflict());
            }
            let secret = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
            let mut route = body
                .as_object()
                .cloned()
                .ok_or_else(DesktopFailure::invalid_input)?;
            route.remove("name");
            route.insert("profile".into(), json!(profile));
            route.insert("secret".into(), json!(secret));
            route.insert("created_at".into(), json!(chrono::Utc::now().to_rfc3339()));
            let value = Value::Object(route);
            routes.insert(route_name.clone(), value.clone());
            let mut summary = route_summary(&route_name, &value, base, profile);
            summary["secret"] = json!(secret);
            Ok(summary)
        }
        "webhooks.toggle" | "webhooks.delete" => {
            let route = routes
                .get_mut(&route_name)
                .ok_or_else(DesktopFailure::invalid_input)?;
            if route
                .get("profile")
                .and_then(Value::as_str)
                .unwrap_or("default")
                != profile
            {
                return Err(DesktopFailure::invalid_input());
            }
            if operation == "webhooks.delete" {
                routes.remove(&route_name);
                Ok(json!({"ok": true}))
            } else {
                let enabled = payload
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .ok_or_else(DesktopFailure::invalid_input)?;
                route["enabled"] = json!(enabled);
                Ok(json!({"ok": true, "name": route_name, "enabled": enabled}))
            }
        }
        _ => Err(DesktopFailure::invalid_input()),
    })
}

fn name(payload: &Value) -> Result<&str, DesktopFailure> {
    let value = payload
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if value.is_empty()
        || value.len() > 64
        || !value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && (byte == b'-' || byte == b'_'))
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(value)
}

fn optional_text<'a>(
    payload: &'a Value,
    key: &str,
    max: usize,
) -> Result<Option<&'a str>, DesktopFailure> {
    match payload.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value.len() <= max => Ok(Some(value)),
        _ => Err(DesktopFailure::invalid_input()),
    }
}

fn creation_body(payload: &Value) -> Result<Value, DesktopFailure> {
    let route_name = name(payload)?;
    let deliver = optional_text(payload, "deliver", 32)?.unwrap_or("log");
    if !matches!(
        deliver,
        "log" | "telegram" | "discord" | "slack" | "email" | "github_comment"
    ) {
        return Err(DesktopFailure::invalid_input());
    }
    let deliver_only = payload
        .get("deliver_only")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if deliver_only && deliver == "log" {
        return Err(DesktopFailure::invalid_input());
    }
    let events = payload
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if events.len() > 32
        || events
            .iter()
            .any(|value| !value.as_str().is_some_and(|event| event.len() <= 128))
    {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(json!({
        "name": route_name,
        "description": optional_text(payload, "description", 1024)?.unwrap_or(""),
        "events": events,
        "deliver": deliver,
        "deliver_only": deliver_only,
        "prompt": optional_text(payload, "prompt", 8192)?.unwrap_or(""),
    }))
}

fn request_shape(
    profile: &str,
    operation: &str,
    payload: &Value,
) -> Result<(Method, String, Option<Value>), DesktopFailure> {
    let query = format!("?profile={profile}");
    let (method, path, body) = match operation {
        "webhooks.list" => (Method::GET, format!("/api/webhooks{query}"), None),
        "webhooks.create" => (
            Method::POST,
            format!("/api/webhooks{query}"),
            Some(creation_body(payload)?),
        ),
        "webhooks.toggle" => {
            let enabled = payload
                .get("enabled")
                .and_then(Value::as_bool)
                .ok_or_else(DesktopFailure::invalid_input)?;
            (
                Method::PUT,
                format!("/api/webhooks/{}/enabled{query}", name(payload)?),
                Some(json!({"enabled": enabled})),
            )
        }
        "webhooks.delete" => (
            Method::DELETE,
            format!("/api/webhooks/{}{query}", name(payload)?),
            None,
        ),
        _ => return Err(DesktopFailure::invalid_input()),
    };
    Ok((method, path, body))
}

pub(super) async fn request(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    operation: &str,
    payload: &Value,
) -> Result<Value, DesktopFailure> {
    let (method, _, _) = request_shape(&scope.profile, operation, payload)?;
    let id = (method != Method::GET).then(Uuid::new_v4);
    if let Some(id) = id {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "webhooks operation={id} phase=start action={operation} profile={}",
                scope.profile
            ),
        );
    }
    let result = async {
        scope.owned_home()?;
        let root = scope.storage.join("hermes-home");
        // The named profile's native ticket cannot read another profile's Dashboard
        // data, even with ?profile=default. Use the desktop-owned default scope for
        // the shared listener's status; route mutations remain bound to `scope`.
        let listener_scope = if scope.profile == "default" {
            None
        } else {
            Some(state.resolve_profile("default").await?)
        };
        let listener = config_request_for_scope(
            state,
            listener_scope.as_ref().unwrap_or(scope),
            Method::GET,
            "/api/webhooks?profile=default",
            None,
        )
        .await?;
        let enabled = listener
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let base = listener
            .get("base_url")
            .and_then(Value::as_str)
            .ok_or_else(DesktopFailure::operation_failed)?
            .to_owned();
        let profile = scope.profile.clone();
        if !enabled && operation != "webhooks.list" {
            return Err(DesktopFailure::conflict());
        }
        let listing = operation == "webhooks.list";
        let operation = operation.to_owned();
        let payload = payload.clone();
        let mut response = tokio::task::spawn_blocking(move || {
            named_request(&root, &profile, &operation, &payload, &base)
        })
        .await
        .map_err(|_| DesktopFailure::operation_failed())??;
        if listing {
            response["enabled"] = json!(enabled);
        }
        scope.ensure_current(state).await?;
        Ok(response)
    }
    .await;
    if let Some(id) = id {
        let status = if result.is_ok() {
            "completed"
        } else {
            "failed"
        };
        let _ = crate::diagnostics::append_client_event(&scope.storage,
            &format!("webhooks operation={id} phase=finish action={operation} profile={} status={status}", scope.profile));
    }
    result
}

#[cfg(test)]
#[path = "tests/webhooks.rs"]
mod tests;
