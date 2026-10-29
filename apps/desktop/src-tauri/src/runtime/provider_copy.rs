use super::{
    config::config_request_for_scope,
    models::{read_model_lists_file, write_model_lists_file},
    profile_scope::ResolvedProfileScope,
    BackendState,
};
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::State;

static COPY_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn lists_path(scope: &ResolvedProfileScope) -> std::path::PathBuf {
    if scope.profile == "default" {
        scope.storage.join("model-candidates.json")
    } else {
        scope.home.join("model-candidates.json")
    }
}

fn model_details(
    scope: &ResolvedProfileScope,
    endpoint_id: &str,
    models: &[Value],
) -> Result<Value, DesktopFailure> {
    let bytes = std::fs::read(scope.home.join("config.yaml"))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(DesktopFailure::operation_failed());
    }
    let yaml: serde_yaml::Value =
        serde_yaml::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    let config = serde_json::to_value(yaml).map_err(|_| DesktopFailure::operation_failed())?;
    let entry = config.get("providers").and_then(|v| v.get(endpoint_id));
    Ok(json!(models
        .iter()
        .filter_map(|id| {
            let id = id.as_str()?;
            let row = entry?.get("models")?.get(id)?;
            let mut detail = json!({"id":id});
            for key in ["canonical_model", "reasoning_effort"] {
                if let Some(value) = row
                    .get(key)
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                {
                    detail[key] = json!(value);
                }
            }
            (detail.as_object()?.len() > 1).then_some(detail)
        })
        .collect::<Vec<_>>()))
}

async fn main_config(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
) -> Result<Value, DesktopFailure> {
    let config =
        config_request_for_scope(state, scope, reqwest::Method::GET, "/api/config", None).await?;
    Ok(config.get("model").cloned().unwrap_or(Value::Null))
}

pub(super) fn conflicts(source: &Value, target: &Value) -> bool {
    let normalized = |v: &Value, key: &str| {
        v.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .trim_end_matches('/')
            .to_lowercase()
    };
    ["id", "name", "base_url"]
        .iter()
        .any(|key| normalized(source, key) == normalized(target, key))
}

pub(super) fn template(endpoint: &Value, models: Vec<String>) -> Result<Value, DesktopFailure> {
    if endpoint["source"] == "direct-config"
        || ["id", "name", "base_url", "model"].iter().any(|key| {
            !endpoint
                .get(*key)
                .and_then(Value::as_str)
                .is_some_and(|s| !s.trim().is_empty())
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut body = json!({"name":endpoint["name"],"base_url":endpoint["base_url"],"model":endpoint["model"],"models":models,"api_key":"","make_default":false,"discover_models":endpoint.get("discover_models").cloned().unwrap_or(json!(true))});
    for key in ["api_mode", "context_length"] {
        if let Some(value) = endpoint.get(key) {
            body[key] = value.clone();
        }
    }
    Ok(body)
}

fn verified_public_fields(actual: &Value, body: &Value) -> bool {
    let expected_models: std::collections::BTreeSet<_> = body["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .chain(body["model"].as_str())
        .collect();
    let actual_models: std::collections::BTreeSet<_> = actual["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    [
        "name",
        "base_url",
        "model",
        "discover_models",
        "api_mode",
        "context_length",
    ]
    .iter()
    .all(|key| actual[*key] == body[*key])
        && actual["has_api_key"] == false
        && expected_models == actual_models
}

async fn snapshot(
    state: &State<'_, BackendState>,
    profile: &str,
    endpoint_id: &str,
    target: &str,
) -> Result<(Value, Value, ResolvedProfileScope, Value), DesktopFailure> {
    if profile == target {
        return Err(DesktopFailure::invalid_input());
    }
    let source = state.resolve_profile(profile).await?;
    let target_scope = state.resolve_profile(target).await?;
    if source.gateway_epoch != target_scope.gateway_epoch {
        return Err(DesktopFailure::conflict());
    }
    let source_list = config_request_for_scope(
        state,
        &source,
        reqwest::Method::GET,
        "/api/providers/custom-endpoints",
        None,
    )
    .await?;
    let endpoint = source_list["endpoints"]
        .as_array()
        .and_then(|rows| rows.iter().find(|r| r["id"] == endpoint_id))
        .ok_or_else(DesktopFailure::conflict)?;
    let models = read_model_lists_file(&lists_path(&source))?
        .and_then(|m| m.get(endpoint_id).cloned())
        .unwrap_or_else(|| {
            endpoint["models"]
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default()
        });
    let mut body = template(endpoint, models)?;
    body["model_details"] = model_details(
        &source,
        endpoint_id,
        body["models"]
            .as_array()
            .ok_or_else(DesktopFailure::invalid_input)?,
    )?;
    let target_list = config_request_for_scope(
        state,
        &target_scope,
        reqwest::Method::GET,
        "/api/providers/custom-endpoints",
        None,
    )
    .await?;
    let exists = target_list["endpoints"]
        .as_array()
        .is_none_or(|rows| rows.iter().any(|r| conflicts(endpoint, r)));
    let target_lists: std::collections::BTreeMap<_, _> =
        read_model_lists_file(&lists_path(&target_scope))?
            .unwrap_or_default()
            .into_iter()
            .collect();
    let target_main = main_config(state, &target_scope).await?;
    let digest = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!([
                body,
                target_list,
                target_lists,
                source.gateway_epoch,
                target_main
            ]))
            .map_err(|_| DesktopFailure::operation_failed())?
        )
    );
    let preview = json!({"source":profile,"endpointId":endpoint_id,"target":target,"digest":digest,"eligible":!exists,"reason":if exists {"目标已有同 ID、名称或地址的提供商，禁止同步"} else {"仅复制配置，目标需要重新配置认证"},"name":body["name"],"models":body["models"]});
    Ok((preview, body, target_scope, target_main))
}

#[tauri::command]
pub async fn preview_provider_copy(
    state: State<'_, BackendState>,
    profile: String,
    endpoint_id: String,
    target: String,
) -> Result<Value, DesktopFailure> {
    snapshot(&state, &profile, &endpoint_id, &target)
        .await
        .map(|r| r.0)
}

#[tauri::command]
pub async fn copy_provider(
    state: State<'_, BackendState>,
    profile: String,
    endpoint_id: String,
    target: String,
    expected_digest: String,
) -> Result<Value, DesktopFailure> {
    let _guard = COPY_LOCK.lock().await;
    let (preview, mut body, scope, target_main) =
        snapshot(&state, &profile, &endpoint_id, &target).await?;
    if preview["digest"] != expected_digest || preview["eligible"] != true {
        return Err(DesktopFailure::conflict());
    }
    // The upstream API is an upsert. A fresh ID guarantees this operation cannot
    // select an existing provider even if another client creates the same name.
    let id = format!("copy-{}", uuid::Uuid::new_v4());
    body["id"] = json!(id);
    config_request_for_scope(
        &state,
        &scope,
        reqwest::Method::POST,
        "/api/providers/custom-endpoints",
        Some(body.clone()),
    )
    .await?;
    let verification = async {
        let mut lists = read_model_lists_file(&lists_path(&scope))?.unwrap_or_default();
        let models: Vec<String> = serde_json::from_value(body["models"].clone())
            .map_err(|_| DesktopFailure::operation_failed())?;
        lists.insert(id.clone(), models.clone());
        scope.ensure_current(&state).await?;
        write_model_lists_file(&lists_path(&scope), &lists)?;
        let listing = config_request_for_scope(
            &state,
            &scope,
            reqwest::Method::GET,
            "/api/providers/custom-endpoints",
            None,
        )
        .await?;
        let actual = listing["endpoints"]
            .as_array()
            .and_then(|rows| rows.iter().find(|r| r["id"] == id))
            .ok_or_else(DesktopFailure::conflict)?;
        let matches = verified_public_fields(actual, &body)
            && main_config(&state, &scope).await? == target_main
            && model_details(
                &scope,
                &id,
                body["models"]
                    .as_array()
                    .ok_or_else(DesktopFailure::operation_failed)?,
            )? == body["model_details"]
            && read_model_lists_file(&lists_path(&scope))?
                .is_some_and(|m| m.get(&id) == Some(&models));
        Ok::<bool, DesktopFailure>(matches)
    }
    .await
    .unwrap_or(false);
    Ok(json!({"status":if verification {"copied"} else {"unverified"},"endpointId":id}))
}

#[cfg(test)]
#[path = "tests/provider_copy.rs"]
mod tests;
