use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashMap, time::Duration};
use tauri::{AppHandle, Emitter};
use tokio::{
    sync::{mpsc, oneshot},
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};

struct RpcRequest {
    method: &'static str,
    params: Value,
    reply: oneshot::Sender<Result<Value, String>>,
}

type PendingRpc = HashMap<u64, (&'static str, oneshot::Sender<Result<Value, String>>)>;

fn prune_abandoned_rpc(pending: &mut PendingRpc) {
    pending.retain(|_, (_, reply)| !reply.is_closed());
}

#[cfg(test)]
#[path = "tests/gateway_state.rs"]
mod state_tests;

enum GatewayCommand {
    Rpc(RpcRequest),
    Answer {
        id: String,
        method: String,
        result: Value,
        reply: oneshot::Sender<Result<(), String>>,
    },
}

fn validate_server_answer(
    requests: &HashMap<String, (String, Value)>,
    id: &str,
    method: &str,
    result: &Value,
) -> Result<(), String> {
    let Some((expected_method, params)) = requests.get(id) else {
        return Err("审批请求已失效".into());
    };
    if expected_method != method {
        return Err("请求类型与原请求不一致".into());
    }
    if method == "approval" {
        let selected = result.get("choice").and_then(Value::as_str);
        let allowed = params
            .get("choices")
            .and_then(Value::as_array)
            .map_or(selected == Some("deny"), |choices| {
                choices.iter().any(|choice| choice.as_str() == selected)
            });
        if !allowed {
            return Err("此审批选项未被后端提供".into());
        }
    } else if method == "clarify" {
        let questions = params
            .get("questions")
            .and_then(Value::as_array)
            .ok_or("澄清请求缺少问题")?;
        let answers = result
            .get("answers")
            .and_then(Value::as_object)
            .ok_or("澄清回应缺少答案")?;
        if answers.iter().any(|(qid, answer)| {
            !questions
                .iter()
                .any(|question| question.get("qid").and_then(Value::as_str) == Some(qid.as_str()))
                || !answer.is_null() && !answer.is_string()
        }) {
            return Err("澄清答案与当前问题不一致".into());
        }
    }
    Ok(())
}

#[derive(Clone, Serialize)]
struct GatewayEvent {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq: Option<u64>,
    payload: Value,
}

fn is_forwarded_event(kind: &str) -> bool {
    matches!(
        kind,
        "message.start"
            | "message.delta"
            | "message.complete"
            | "reasoning.delta"
            | "reasoning.available"
            | "error"
            | "tool.start"
            | "tool.progress"
            | "tool.complete"
            | "status.update"
            | "request.cancel"
    )
}

#[derive(Clone, Serialize)]
struct GatewayServerRequest {
    id: String,
    method: String,
    params: Value,
}

pub struct GatewayClient {
    sender: mpsc::Sender<GatewayCommand>,
    task: JoinHandle<()>,
    pub replay_epoch: String,
}

impl GatewayClient {
    pub async fn connect(port: u16, ticket: &str, app: AppHandle) -> Result<Self, String> {
        let url = format!("ws://127.0.0.1:{port}/api/ws");
        let mut request = url
            .into_client_request()
            .map_err(|_| "无法构造网关连接".to_string())?;
        let protocol = format!("hermes-gateway-v1, hermes-gateway-ticket.{ticket}");
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            HeaderValue::from_str(&protocol).map_err(|_| "无效的网关票据".to_string())?,
        );
        let (socket, response) = timeout(Duration::from_secs(5), connect_async(request))
            .await
            .map_err(|_| "网关连接超时".to_string())?
            .map_err(|_| "网关鉴权或连接失败".to_string())?;
        if response
            .headers()
            .get("Sec-WebSocket-Protocol")
            .and_then(|v| v.to_str().ok())
            != Some("hermes-gateway-v1")
        {
            return Err("网关未确认桌面会话协议".into());
        }
        let (mut writer, mut reader) = socket.split();
        let (sender, mut receiver) = mpsc::channel::<GatewayCommand>(64);
        let (ready_sender, ready_receiver) = oneshot::channel();
        let task = tokio::spawn(async move {
            let mut next_id = 1u64;
            let mut pending = PendingRpc::new();
            let mut server_requests = HashMap::<String, (String, Value)>::new();
            let mut ready_sender = Some(ready_sender);
            loop {
                tokio::select! {
                    command = receiver.recv() => {
                        let Some(command) = command else { break };
                        match command {
                            GatewayCommand::Rpc(request) => {
                                if request.reply.is_closed() { continue; }
                                prune_abandoned_rpc(&mut pending);
                                if pending.len() >= 64 {
                                    let _ = request.reply.send(Err("待处理的网关请求过多".into()));
                                    continue;
                                }
                                let id = next_id;
                                next_id += 1;
                                let frame = json!({"jsonrpc":"2.0","id":id,"method":request.method,"params":request.params});
                                if writer.send(Message::Text(frame.to_string().into())).await.is_err() {
                                    let _ = request.reply.send(Err("网关连接已断开".into()));
                                    break;
                                }
                                pending.insert(id, (request.method, request.reply));
                            }
                            GatewayCommand::Answer { id, method, result, reply } => {
                                if reply.is_closed() { continue; }
                                if let Err(error) = validate_server_answer(&server_requests, &id, &method, &result) {
                                    let _ = reply.send(Err(error));
                                    continue;
                                }
                                server_requests.remove(&id);
                                let frame = json!({"jsonrpc":"2.0","id":id,"result":result});
                                if writer.send(Message::Text(frame.to_string().into())).await.is_err() {
                                    let _ = reply.send(Err("网关连接已断开".into()));
                                    break;
                                }
                                let _ = reply.send(Ok(()));
                            }
                        }
                    }
                    frame = reader.next() => {
                        let Some(frame) = frame else { break };
                        let Ok(frame) = frame else { break };
                        let Message::Text(text) = frame else { continue };
                        let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
                        if let Some(id) = value.get("id").and_then(Value::as_u64) {
                            if let Some((method, reply)) = pending.remove(&id) {
                                let outcome = if let Some(error) = value.get("error") {
                                    let code = error.get("code").and_then(Value::as_i64).unwrap_or(0);
                                    let message = error.get("message").and_then(Value::as_str).unwrap_or("未知 RPC 错误");
                                    Err(format!("{message} ({code})"))
                                } else {
                                    let result = value.get("result").cloned().unwrap_or(Value::Null);
                                    if matches!(method, "session.resume" | "session.events.since") {
                                        if let Some(requests) = result.get("open_requests").and_then(Value::as_array) {
                                            for request in requests.iter().take(64) {
                                                if let (Some(id), Some(kind), Some(params)) = (
                                                    request.get("id").and_then(Value::as_str),
                                                    request.get("method").and_then(Value::as_str),
                                                    request.get("params"),
                                                ) {
                                                    if matches!(kind, "approval" | "clarify") && id.starts_with("srq-") && params.to_string().len() <= 32 * 1024 {
                                                        server_requests.insert(id.to_owned(), (kind.to_owned(), params.clone()));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    Ok(result)
                                };
                                let _ = reply.send(outcome);
                            } else if value.get("method").is_some() {
                                let refusal = json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"client method unavailable"}});
                                if writer.send(Message::Text(refusal.to_string().into())).await.is_err() { break; }
                            }
                            continue;
                        }
                        if let (Some(id), Some(method)) = (value.get("id"), value.get("method").and_then(Value::as_str)) {
                            let Some(id_text) = id.as_str() else { continue };
                            let params = value.get("params").cloned().unwrap_or(Value::Null);
                            if matches!(method, "approval" | "clarify") && params.to_string().len() <= 32 * 1024 && server_requests.len() < 64 {
                                server_requests.insert(id_text.to_owned(), (method.to_owned(), params.clone()));
                                let request = GatewayServerRequest { id: id_text.to_owned(), method: method.to_owned(), params };
                                if app.emit("hermes-request", request).is_ok() { continue; }
                                server_requests.remove(id_text);
                            }
                            let refusal = json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"client method unavailable"}});
                            if writer.send(Message::Text(refusal.to_string().into())).await.is_err() { break; }
                            continue;
                        }
                        if value.get("method").and_then(Value::as_str) != Some("event") { continue; }
                        let Some(params) = value.get("params") else { continue };
                        let Some(kind) = params.get("type").and_then(Value::as_str) else { continue };
                        if kind == "gateway.ready" {
                            if let Some(sender) = ready_sender.take() {
                                let epoch = params.pointer("/payload/replay_epoch").and_then(Value::as_str).unwrap_or("").to_owned();
                                let _ = sender.send(epoch);
                            }
                            continue;
                        }
                        if kind == "request.cancel" {
                            if let Some(id) = params.pointer("/payload/id").and_then(Value::as_str) { server_requests.remove(id); }
                        }
                        if !is_forwarded_event(kind) { continue; }
                        let payload = params.get("payload").filter(|value| value.is_object()).cloned().unwrap_or_else(|| json!({}));
                        if payload.to_string().len() > 32 * 1024 { continue; }
                        let event = GatewayEvent {
                            kind: kind.into(),
                            session_id: params.get("session_id").and_then(Value::as_str).map(str::to_owned),
                            seq: params.get("seq").and_then(Value::as_u64),
                            payload,
                        };
                        let _ = app.emit("hermes-event", event);
                    }
                }
            }
            for (_, (_, reply)) in pending {
                let _ = reply.send(Err("网关连接已断开".into()));
            }
            let _ = app.emit("hermes-disconnected", ());
        });
        let replay_epoch = match timeout(Duration::from_secs(5), ready_receiver).await {
            Ok(Ok(epoch)) => epoch,
            Ok(Err(_)) => {
                task.abort();
                return Err("网关在就绪前断开".to_string());
            }
            Err(_) => {
                task.abort();
                return Err("等待网关就绪事件超时".to_string());
            }
        };
        let client = Self {
            sender,
            task,
            replay_epoch,
        };
        if let Err(error) = client
            .request(
                "client.capabilities",
                json!({"server_requests":true,"desktop_local":true}),
            )
            .await
        {
            client.close();
            return Err(error);
        }
        Ok(client)
    }

    pub async fn request(&self, method: &'static str, params: Value) -> Result<Value, String> {
        let (reply, received) = oneshot::channel();
        timeout(Duration::from_secs(30), async {
            self.sender
                .send(GatewayCommand::Rpc(RpcRequest {
                    method,
                    params,
                    reply,
                }))
                .await
                .map_err(|_| "网关连接已断开".to_string())?;
            received.await.map_err(|_| "网关连接已断开".to_string())?
        })
        .await
        .map_err(|_| "网关请求超时；写操作结果未知，请先恢复会话".to_string())?
    }

    pub async fn answer(&self, id: String, method: String, result: Value) -> Result<(), String> {
        let (reply, received) = oneshot::channel();
        timeout(Duration::from_secs(30), async {
            self.sender
                .send(GatewayCommand::Answer {
                    id,
                    method,
                    result,
                    reply,
                })
                .await
                .map_err(|_| "网关连接已断开".to_string())?;
            received.await.map_err(|_| "网关连接已断开".to_string())?
        })
        .await
        .map_err(|_| "网关回应超时；结果未知，请先恢复会话".to_string())?
    }

    pub fn close(&self) {
        self.task.abort();
    }

    pub fn is_closed(&self) -> bool {
        self.task.is_finished()
    }
}

#[cfg(test)]
#[path = "tests/gateway_contract.rs"]
mod contract_tests;
