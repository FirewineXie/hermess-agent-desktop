use super::{config::config_request_for_scope, profile_scope::ResolvedProfileScope, BackendState};
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use tauri::State;

pub(super) const MAX_DOCUMENT_BYTES: usize = 256 * 1024;

pub(super) fn parse_document(text: &str) -> Result<Value, DesktopFailure> {
    if text.len() > MAX_DOCUMENT_BYTES {
        return Err(DesktopFailure::invalid_input());
    }
    let value: serde_yaml::Value =
        serde_yaml::from_str(text).map_err(|_| DesktopFailure::invalid_input())?;
    if !value.is_mapping() {
        return Err(DesktopFailure::invalid_input());
    }
    serde_json::to_value(value).map_err(|_| DesktopFailure::invalid_input())
}

pub(super) fn replace_field(
    document: &mut Value,
    key: &str,
    value: Value,
) -> Result<(), DesktopFailure> {
    let parts: Vec<_> = key.split('.').collect();
    let mut target = document;
    for part in &parts[..parts.len() - 1] {
        let object = target
            .as_object_mut()
            .ok_or_else(DesktopFailure::invalid_input)?;
        target = object.entry(*part).or_insert_with(|| json!({}));
    }
    target
        .as_object_mut()
        .ok_or_else(DesktopFailure::invalid_input)?
        .insert(parts[parts.len() - 1].to_owned(), value);
    Ok(())
}

fn with_defaults(mut defaults: Value, configured: &Value) -> Value {
    if let (Some(target), Some(source)) = (defaults.as_object_mut(), configured.as_object()) {
        for (key, value) in source {
            let merged = with_defaults(target.remove(key).unwrap_or(Value::Null), value);
            target.insert(key.clone(), merged);
        }
        defaults
    } else {
        configured.clone()
    }
}

pub(super) fn documents_match(expected: &Value, actual: &Value, defaults: &Value) -> bool {
    with_defaults(defaults.clone(), expected) == with_defaults(defaults.clone(), actual)
}

/// The upstream writer reserializes YAML and strips defaults. Verify values,
/// including deletions, rather than byte formatting or comments.
pub(super) async fn write_document(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    text: &str,
    expected_yaml: &str,
) -> Result<Value, DesktopFailure> {
    let desired = parse_document(text)?;
    let defaults = config_request_for_scope(
        state,
        scope,
        reqwest::Method::GET,
        "/api/config/defaults",
        None,
    )
    .await?;
    let current =
        config_request_for_scope(state, scope, reqwest::Method::GET, "/api/config/raw", None)
            .await?;
    if current["yaml"].as_str() != Some(expected_yaml) {
        return Err(DesktopFailure::conflict());
    }
    config_request_for_scope(
        state,
        scope,
        reqwest::Method::PUT,
        "/api/config/raw",
        Some(json!({"yaml_text":text})),
    )
    .await?;
    let raw = config_request_for_scope(state, scope, reqwest::Method::GET, "/api/config/raw", None)
        .await?;
    let verified = raw["yaml"]
        .as_str()
        .and_then(|text| parse_document(text).ok())
        .is_some_and(|actual| documents_match(&desired, &actual, &defaults));
    Ok(json!({"raw":raw,"verified":verified}))
}

#[cfg(test)]
#[path = "tests/config_document.rs"]
mod tests;
