use serde_json::{json, Map, Value};

// These tasks use config.yaml at runtime but are absent from the locked model picker.
const SUPPLEMENTAL_TASKS: [&str; 6] = [
    "background_review",
    "memory_query_rewrite",
    "tts_audio_tags",
    "goal_judge",
    "group_router",
    "monitor",
];

const ENDPOINT_OVERRIDES: [&str; 6] = [
    "base_url",
    "api_key",
    "api",
    "key_env",
    "api_key_env",
    "api_mode",
];

pub(super) fn has_field(schema: &Value, task: &str, field: &str) -> bool {
    schema["fields"]
        .get(format!("auxiliary.{task}.{field}"))
        .is_some()
}

pub(super) fn supplemental_tasks(state: &Value, schema: &Value) -> Vec<&'static str> {
    SUPPLEMENTAL_TASKS
        .into_iter()
        .filter(|task| {
            super::auxiliary_task(state, task).is_none()
                && has_field(schema, task, "provider")
                && has_field(schema, task, "model")
        })
        .collect()
}

pub(super) fn append_supplemental_tasks(state: &mut Value, schema: &Value, config: &Value) {
    let tasks = supplemental_tasks(state, schema);
    if let Some(rows) = state.get_mut("tasks").and_then(Value::as_array_mut) {
        rows.extend(tasks.into_iter().map(|task| {
            let route = &config["auxiliary"][task];
            let effort = if has_field(schema, task, "reasoning_effort") {
                route["reasoning_effort"].as_str().filter(|value| !value.is_empty())
            } else {
                None
            };
            json!({
                "task": task,
                "provider": route["provider"].as_str().filter(|value| !value.is_empty()).unwrap_or("auto"),
                "model": route["model"].as_str().unwrap_or_default(),
                "base_url": route["base_url"].as_str().unwrap_or_default(),
                "reasoning_effort": effort,
            })
        }));
    }
}

pub(super) fn route_patch(
    current: &Value,
    provider: &str,
    model: &str,
    effort: Option<&str>,
    timeout: Option<f64>,
    reset: bool,
) -> Value {
    let mut route = json!({"provider": provider, "model": model});
    if let Some(effort) = effort {
        route["reasoning_effort"] = json!(effort);
    }
    if let Some(timeout) = timeout {
        route["timeout"] = json!(timeout);
    }
    let previous = current["provider"]
        .as_str()
        .filter(|value| !value.is_empty())
        .unwrap_or("auto");
    if reset || !previous.eq_ignore_ascii_case(provider) {
        for field in ENDPOINT_OVERRIDES {
            if !current[field].is_null() && current[field].as_str() != Some("") {
                route[field] = json!("");
            }
        }
    }
    route
}

pub(super) fn reset_patch(state: &Value, schema: &Value, config: &Value) -> Map<String, Value> {
    supplemental_tasks(state, schema)
        .into_iter()
        .map(|task| {
            let current = &config["auxiliary"][task];
            let effort = (has_field(schema, task, "reasoning_effort")
                || !current["reasoning_effort"].is_null())
            .then_some("");
            let route = route_patch(current, "auto", "", effort, None, true);
            (task.to_owned(), route)
        })
        .collect()
}

pub(super) fn patch_request(patch: &Map<String, Value>) -> Value {
    json!({"config": {"auxiliary": patch}})
}

pub(super) fn patch_matches(patch: &Map<String, Value>, config: &Value) -> bool {
    patch.iter().all(|(task, route)| {
        let actual = &config["auxiliary"][task];
        route.as_object().is_some_and(|fields| {
            fields.iter().all(|(field, expected)| {
                let saved = &actual[field];
                saved == expected
                    || (expected.as_str() == Some("") && saved.is_null())
                    || (field == "timeout" && saved.as_f64() == expected.as_f64())
            })
        })
    })
}
