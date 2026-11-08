use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationStage {
    Profile,
    Authentication,
    Endpoint,
    Stream,
    ToolCall,
    ToolResult,
    Connection,
    Timeout,
}

fn completed(bytes: &[u8]) -> Result<Value, ValidationStage> {
    let text = std::str::from_utf8(bytes).map_err(|_| ValidationStage::Stream)?;
    let mut data = Vec::new();
    let mut result = None;
    for line in text.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if !data.is_empty() {
                let raw = data.join("\n");
                data.clear();
                if raw != "[DONE]" {
                    let event: Value =
                        serde_json::from_str(&raw).map_err(|_| ValidationStage::Stream)?;
                    match event["type"].as_str() {
                        Some("response.completed") => result = Some(event["response"].clone()),
                        Some("response.failed" | "error") => return Err(ValidationStage::Endpoint),
                        _ => {}
                    }
                }
            }
        } else if let Some(value) = line.strip_prefix("data:") {
            data.push(value.trim_start().to_owned());
        }
    }
    let result = result.ok_or(ValidationStage::Stream)?;
    if result["status"] != "completed" || !result["output"].is_array() {
        return Err(ValidationStage::Stream);
    }
    Ok(result)
}

async fn request(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    body: &Value,
) -> Result<Value, ValidationStage> {
    let mut response = client
        .post(url)
        .bearer_auth(key)
        .json(body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                ValidationStage::Timeout
            } else {
                ValidationStage::Connection
            }
        })?;
    match response.status().as_u16() {
        401 | 403 => return Err(ValidationStage::Authentication),
        200 => {}
        _ => return Err(ValidationStage::Endpoint),
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/event-stream"))
    {
        return Err(ValidationStage::Stream);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ValidationStage::Connection)?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err(ValidationStage::Stream);
        }
        bytes.extend_from_slice(&chunk);
    }
    completed(&bytes)
}

pub(super) async fn validate(
    base_url: &str,
    key: &str,
    models: &[String],
) -> Result<(), ValidationStage> {
    if models.is_empty() {
        return Err(ValidationStage::Endpoint);
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ValidationStage::Connection)?;
    let url = format!("{}/responses", base_url.trim_end_matches('/'));
    for model in models {
        let nonce = Uuid::new_v4().to_string();
        let tool = json!({"type":"function","name":"hermess_connection_check","description":"Return the provided nonce to verify this connection.","strict":true,
            "parameters":{"type":"object","properties":{"nonce":{"type":"string","enum":[nonce]}},"required":["nonce"],"additionalProperties":false}});
        let input = vec![
            json!({"role":"user","content":[{"type":"input_text","text":format!("Call hermess_connection_check with nonce {nonce}. After its result, reply with exactly the nonce.")} ]}),
        ];
        let first = request(&client, &url, key, &json!({"model":model,"stream":true,"input":input,"tools":[tool],"tool_choice":{"type":"function","name":"hermess_connection_check"}})).await?;
        let output = first["output"]
            .as_array()
            .ok_or(ValidationStage::ToolCall)?;
        let call = output
            .iter()
            .find(|item| {
                item["type"] == "function_call" && item["name"] == "hermess_connection_check"
            })
            .ok_or(ValidationStage::ToolCall)?;
        let args: Value = serde_json::from_str(
            call["arguments"]
                .as_str()
                .ok_or(ValidationStage::ToolCall)?,
        )
        .map_err(|_| ValidationStage::ToolCall)?;
        if args["nonce"] != nonce {
            return Err(ValidationStage::ToolCall);
        }
        let call_id = call["call_id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or(ValidationStage::ToolCall)?;
        let mut follow_up = input;
        follow_up.extend(output.iter().cloned());
        follow_up.push(json!({"type":"function_call_output","call_id":call_id,"output":nonce}));
        let last = request(&client, &url, key, &json!({"model":model,"stream":true,"input":follow_up,"tools":[tool],"tool_choice":"none"})).await?;
        let reply: String = last["output"]
            .as_array()
            .ok_or(ValidationStage::ToolResult)?
            .iter()
            .filter(|item| item["type"] == "message")
            .flat_map(|item| item["content"].as_array().into_iter().flatten())
            .filter_map(|part| part["text"].as_str())
            .collect();
        if !reply.contains(&nonce) {
            return Err(ValidationStage::ToolResult);
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/coding_validation.rs"]
pub(super) mod tests;
