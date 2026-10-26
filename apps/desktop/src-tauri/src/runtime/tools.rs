use super::{BackendState, BundledTool, BundledToolsInventory};
use crate::errors::DesktopFailure;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Component, Path},
};
use tauri::State;

#[tauri::command]
pub async fn list_bundled_tools(
    state: State<'_, BackendState>,
) -> Result<BundledToolsInventory, DesktopFailure> {
    let root = {
        let owned = state.0.lock().await;
        owned
            .as_ref()
            .ok_or_else(DesktopFailure::runtime_unavailable)?
            .bundled_tools_root
            .clone()
    };
    let Some(root) = root else {
        return Ok(BundledToolsInventory {
            has_manifest: false,
            tools: Vec::new(),
        });
    };
    let facts_path = root.join("facts.json");
    let metadata = fs::metadata(&facts_path).map_err(|_| "运行时工具清单缺失".to_string())?;
    if metadata.len() > 1024 * 1024 {
        return Err("运行时工具清单过大".into());
    }
    let facts: Value = serde_json::from_slice(
        &fs::read(&facts_path).map_err(|_| "无法读取运行时工具清单".to_string())?,
    )
    .map_err(|_| "运行时工具清单格式无效".to_string())?;
    let packages = facts
        .get("packages")
        .and_then(Value::as_object)
        .ok_or("运行时工具清单缺少包列表")?;
    let mut tools = Vec::new();
    for (name, package) in packages.iter().take(256) {
        let Some(entry) = package.get("entry").and_then(Value::as_str) else {
            continue;
        };
        let mut components = Path::new(entry).components();
        if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
            continue;
        }
        let path = root.join(entry);
        tools.push(BundledTool {
            name: name.clone(),
            version: package
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            path: path.to_string_lossy().into_owned(),
            present: path.is_dir(),
        });
    }
    Ok(BundledToolsInventory {
        has_manifest: true,
        tools,
    })
}

#[tauri::command]
pub async fn list_agent_toolsets(
    state: State<'_, BackendState>,
    session_id: Option<String>,
) -> Result<Value, DesktopFailure> {
    if session_id.is_none() && !state.is_default_profile().await? {
        return Err(DesktopFailure::conflict());
    }
    let gateway = state.gateway().await?;
    gateway
        .request("tools.list", json!({"session_id": session_id}))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_active_agent_tools(
    state: State<'_, BackendState>,
    session_id: Option<String>,
) -> Result<Value, DesktopFailure> {
    if session_id.is_none() && !state.is_default_profile().await? {
        return Err(DesktopFailure::conflict());
    }
    let gateway = state.gateway().await?;
    gateway
        .request("tools.show", json!({"session_id": session_id}))
        .await
        .map_err(Into::into)
}
