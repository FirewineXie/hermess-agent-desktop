//! Observe the authenticated local transport before payload truncation/UI forwarding.
use super::{GatewayCommand, GatewayRequestError, RpcRequest};
use crate::computer_activity::{self, Key, Stop};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot};

#[derive(Clone)]
pub(crate) struct GatewayStop {
    sender: mpsc::Sender<GatewayCommand>,
    profile: String,
    session: String,
    generation: u64,
}

impl GatewayStop {
    pub(super) fn rebind(&mut self, sender: &mpsc::Sender<GatewayCommand>) {
        self.sender = sender.clone();
    }
    pub(crate) async fn interrupt(&self) -> Result<Value, GatewayRequestError> {
        let (reply, received) = oneshot::channel();
        let mut params = json!({"session_id":self.session,"execution_generation":self.generation});
        if self.profile != "default" {
            params["profile"] = json!(self.profile);
        }
        // Never stop a newer generation after stale_generation: it may be unrelated work.
        tokio::time::timeout(Duration::from_secs(30), async {
            self.sender
                .send(GatewayCommand::Rpc(RpcRequest {
                    method: "session.interrupt",
                    params,
                    reply,
                }))
                .await
                .map_err(|_| GatewayRequestError::Transport("网关连接已断开".into()))?;
            received
                .await
                .map_err(|_| GatewayRequestError::Transport("网关连接已断开".into()))?
        })
        .await
        .map_err(|_| GatewayRequestError::Transport("停止请求超时".into()))?
    }
}

fn native_provider(home: &Path, profile: &str) -> bool {
    if profile.is_empty() || profile.contains(['/', '\\']) || profile == "." || profile == ".." {
        return false;
    }
    let home = if profile == "default" {
        home.to_path_buf()
    } else {
        home.join("profiles").join(profile)
    };
    let config = match std::fs::read(crate::paths::filesystem_path(&home.join("config.yaml"))) {
        Ok(bytes) => match serde_yaml::from_slice::<serde_yaml::Value>(&bytes) {
            Ok(value) => value,
            Err(_) => return false,
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_yaml::Value::Null,
        Err(_) => return false,
    };
    // Locked plugins/computer_use defaults to cua; other providers can operate remote desktops.
    config["computer_use"]["backend"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("cua")
        == "cua"
}

pub(super) fn observe(
    app: &AppHandle,
    connection: &str,
    sender: &mpsc::Sender<GatewayCommand>,
    home: &Path,
    profile: Option<&str>,
    params: &Value,
) {
    if matches!(
        params["type"].as_str(),
        Some("error" | "session.replay_gap")
    ) {
        if let Some(session) = params["session_id"].as_str() {
            computer_activity::session_unknown(app, connection, session);
        }
        return;
    }
    let (Some(session), Some(generation), Some(profile)) = (
        params["session_id"].as_str(),
        params["execution_generation"].as_u64(),
        profile,
    ) else {
        return;
    };
    let key = Key {
        connection: connection.to_owned(),
        session: session.to_owned(),
        generation,
    };
    let payload = &params["payload"];
    let kind = params["type"].as_str().unwrap_or("");
    let tool = payload["tool_call_id"]
        .as_str()
        .or_else(|| payload["tool_id"].as_str());
    if kind == "tool.start" && payload["name"] == "computer_use" && native_provider(home, profile) {
        if let Some(tool) = tool {
            computer_activity::start(
                app,
                key,
                tool,
                Stop::Gateway(GatewayStop {
                    sender: sender.clone(),
                    profile: profile.to_owned(),
                    session: session.to_owned(),
                    generation,
                }),
            );
        }
    } else if kind == "tool.complete" {
        if let Some(tool) = tool {
            computer_activity::tool_finished(app, &key, tool);
        }
    } else if kind == "message.complete" {
        computer_activity::terminal(app, &key);
    }
}

#[cfg(test)]
#[path = "../tests/computer_activity_gateway.rs"]
mod tests;
