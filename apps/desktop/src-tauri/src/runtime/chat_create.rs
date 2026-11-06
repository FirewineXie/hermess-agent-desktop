use crate::errors::DesktopFailure;
use crate::paths::{filesystem_path, plain_path};
use serde_json::{json, Value};
use std::path::PathBuf;
use uuid::Uuid;

pub(super) fn session_create_params(
    cwd: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    reasoning: Option<String>,
) -> Value {
    let mut params = json!({
        "source": "gui", "request_id": Uuid::new_v4().to_string()
    });
    if let Some(cwd) = cwd {
        params["cwd"] = json!(cwd);
        params["cwd_explicit"] = json!(true);
    }
    if let (Some(provider), Some(model)) = (provider, model) {
        params["provider"] = json!(provider);
        params["model"] = json!(model);
    }
    if let Some(reasoning) = reasoning {
        params["reasoning"] = json!(reasoning);
    }
    params
}

pub(super) fn validate_workspace_path(
    cwd: Option<String>,
) -> Result<Option<String>, DesktopFailure> {
    let Some(path) = cwd.filter(|path| !path.trim().is_empty()) else {
        return Ok(None);
    };
    let directory = plain_path(PathBuf::from(&path).as_path());
    if !directory.is_absolute() || !filesystem_path(&directory).is_dir() {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(Some(directory.to_string_lossy().into_owned()))
}
