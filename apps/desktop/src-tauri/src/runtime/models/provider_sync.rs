use super::validate_custom_endpoint_fields;
use crate::errors::DesktopFailure;
use serde_json::{json, Value};

pub(crate) fn provider_sync_conflict<'a>(
    listing: &'a Value,
    source_id: &str,
    name: &str,
    base_url: &str,
) -> Option<(&'a Value, &'static str)> {
    let endpoints = listing.get("endpoints")?.as_array()?;
    endpoints
        .iter()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(source_id))
        .map(|item| (item, "id"))
        .or_else(|| {
            endpoints
                .iter()
                .find(|item| item.get("name").and_then(Value::as_str) == Some(name))
                .map(|item| (item, "name"))
        })
        .or_else(|| {
            endpoints
                .iter()
                .find(|item| item.get("base_url").and_then(Value::as_str) == Some(base_url))
                .map(|item| (item, "address"))
        })
}

pub(crate) fn provider_sync_difference_fields(
    existing: &Value,
    template: &Value,
) -> Vec<&'static str> {
    let mut changed = Vec::new();
    for key in [
        "name",
        "base_url",
        "model",
        "api_mode",
        "context_length",
        "discover_models",
    ] {
        if existing.get(key).unwrap_or(&Value::Null) != template.get(key).unwrap_or(&Value::Null) {
            changed.push(key);
        }
    }
    let actual = existing.get("models").and_then(Value::as_array);
    let expected = template.get("models").and_then(Value::as_array);
    if actual != expected
        && !actual.zip(expected).is_some_and(|(actual, expected)| {
            actual.len() == expected.len() && expected.iter().all(|model| actual.contains(model))
        })
    {
        changed.push("models");
    }
    if existing.get("has_api_key").and_then(Value::as_bool) == Some(true) {
        changed.push("credential");
    }
    changed
}

pub(crate) fn provider_sync_template(source: &Value) -> Result<Value, DesktopFailure> {
    let required = |key: &str| {
        source
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .ok_or_else(DesktopFailure::invalid_input)
    };
    let name = required("name")?;
    let base_url = required("base_url")?;
    let model = required("model")?;
    validate_custom_endpoint_fields(&name, &base_url, &model, None)?;
    let models: Vec<String> = source
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .collect();
    let api_mode = source
        .get("api_mode")
        .and_then(Value::as_str)
        .filter(|mode| {
            matches!(
                *mode,
                "" | "chat_completions" | "codex_responses" | "anthropic_messages"
            )
        })
        .unwrap_or("");
    Ok(json!({
        "name": name,
        "base_url": base_url,
        "model": model,
        "models": models,
        "api_mode": api_mode,
        "context_length": source.get("context_length").and_then(Value::as_u64).filter(|value| *value > 0),
        "discover_models": source.get("discover_models").and_then(Value::as_bool).unwrap_or(true),
        // POST merges with an existing endpoint; blank explicitly removes the target credential.
        "api_key": "",
        "make_default": false,
    }))
}

pub(crate) fn provider_sync_verified(readback: &Value, target_id: &str, template: &Value) -> bool {
    let Some(endpoint) = readback
        .get("endpoints")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(target_id))
        })
    else {
        return false;
    };
    for key in [
        "name",
        "base_url",
        "model",
        "api_mode",
        "context_length",
        "discover_models",
    ] {
        if endpoint.get(key) != template.get(key) {
            return false;
        }
    }
    let Some(actual_models) = endpoint.get("models").and_then(Value::as_array) else {
        return false;
    };
    let Some(expected_models) = template.get("models").and_then(Value::as_array) else {
        return false;
    };
    expected_models.len() == actual_models.len()
        && expected_models
            .iter()
            .all(|model| actual_models.contains(model))
        && endpoint.get("has_api_key").and_then(Value::as_bool) == Some(false)
}

pub(crate) fn provider_sync_model_details(
    config: &Value,
    endpoint_id: &str,
    model_ids: &Value,
) -> Vec<Value> {
    let Some(models) = config
        .pointer(&format!(
            "/providers/{}/models",
            endpoint_id.replace('~', "~0").replace('/', "~1")
        ))
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };
    model_ids
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|id| {
            let metadata = models.get(id)?.as_object()?;
            let mut detail = serde_json::Map::new();
            detail.insert("id".to_owned(), json!(id));
            for key in ["canonical_model", "reasoning_effort"] {
                if let Some(value) = metadata
                    .get(key)
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                {
                    detail.insert(key.to_owned(), json!(value));
                }
            }
            (detail.len() > 1).then(|| Value::Object(detail))
        })
        .collect()
}
