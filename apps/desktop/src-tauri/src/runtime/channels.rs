use super::{config::config_request, BackendState};
use crate::errors::DesktopFailure;
use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::Mutex;
use uuid::Uuid;

const WEIXIN_BASE: &str = "https://ilinkai.weixin.qq.com";
const WEIXIN_CLIENT_VERSION: &str = "131584";

#[derive(Default)]
pub struct ChannelState(Mutex<HashMap<String, PendingQr>>);

#[derive(Clone)]
struct PendingQr {
    platform: String,
    code: String,
    base: String,
    expires: Instant,
}

#[derive(Serialize)]
pub struct QrStart {
    id: String,
    url: String,
    expires_in: u64,
    poll_interval: u64,
}

#[derive(Serialize)]
pub struct QrPoll {
    status: &'static str,
    restart_required: bool,
}

fn client() -> Result<Client, DesktopFailure> {
    Client::builder()
        .timeout(Duration::from_secs(40))
        .build()
        .map_err(|_| DesktopFailure::connection_lost())
}

async fn feishu_post(body: &[(&str, &str)]) -> Result<Value, DesktopFailure> {
    let response = client()?
        .post("https://accounts.feishu.cn/oauth/v1/app/registration")
        .form(body)
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    response
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())
}

fn valid_weixin_base(base: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    url.scheme() == "https"
        && host.ends_with(".weixin.qq.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn weixin_request(base: &str, path: &str) -> Result<reqwest::RequestBuilder, DesktopFailure> {
    if !valid_weixin_base(base) {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(client()?
        .get(format!("{base}/{path}"))
        .header("iLink-App-Id", "bot")
        .header("iLink-App-ClientVersion", WEIXIN_CLIENT_VERSION))
}

#[tauri::command]
pub async fn channel_status(state: State<'_, BackendState>) -> Result<Value, DesktopFailure> {
    let result = config_request(
        &state,
        reqwest::Method::GET,
        "/api/messaging/platforms",
        None,
    )
    .await?;
    // Never return the dashboard's environment fields to the WebView.
    let platforms = result
        .get("platforms")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(
        json!({"platforms": platforms.iter().filter(|p| p.get("id").and_then(Value::as_str).is_some())
        .map(|p| json!({"id": p.get("id"), "name": p.get("name"), "enabled": p.get("enabled"),
            "configured": p.get("configured"), "state": p.get("state"),
            "error_code": p.get("error_code")})).collect::<Vec<_>>() }),
    )
}

#[tauri::command]
pub async fn channel_qr_start(
    channels: State<'_, ChannelState>,
    platform: String,
) -> Result<QrStart, DesktopFailure> {
    let (code, url, expires_in, poll_interval, base) = match platform.as_str() {
        "feishu" => {
            let init = feishu_post(&[("action", "init")]).await?;
            if !init
                .get("supported_auth_methods")
                .and_then(Value::as_array)
                .is_some_and(|items| items.iter().any(|v| v.as_str() == Some("client_secret")))
            {
                return Err("飞书当前不支持扫码创建机器人".into());
            }
            let value = feishu_post(&[
                ("action", "begin"),
                ("archetype", "PersonalAgent"),
                ("auth_method", "client_secret"),
                ("request_user_info", "open_id"),
            ])
            .await?;
            let code = value
                .get("device_code")
                .and_then(Value::as_str)
                .ok_or("飞书未返回扫码凭据")?;
            let url = value
                .get("verification_uri_complete")
                .and_then(Value::as_str)
                .ok_or("飞书未返回扫码地址")?;
            (
                code.to_owned(),
                format!(
                    "{url}{}from=hermes&tp=hermes",
                    if url.contains('?') { "&" } else { "?" }
                ),
                value
                    .get("expire_in")
                    .and_then(Value::as_u64)
                    .unwrap_or(600)
                    .min(900),
                value
                    .get("interval")
                    .and_then(Value::as_u64)
                    .unwrap_or(5)
                    .clamp(2, 30),
                "feishu".to_owned(),
            )
        }
        "weixin" => {
            let value: Value = weixin_request(WEIXIN_BASE, "ilink/bot/get_bot_qrcode?bot_type=3")?
                .send()
                .await
                .map_err(|_| DesktopFailure::connection_lost())?
                .json()
                .await
                .map_err(|_| DesktopFailure::operation_failed())?;
            let code = value
                .get("qrcode")
                .and_then(Value::as_str)
                .ok_or("微信未返回扫码凭据")?;
            let url = value
                .get("qrcode_img_content")
                .and_then(Value::as_str)
                .ok_or("微信未返回扫码地址")?;
            (
                code.to_owned(),
                url.to_owned(),
                480,
                1,
                WEIXIN_BASE.to_owned(),
            )
        }
        _ => return Err(DesktopFailure::invalid_input()),
    };
    let id = Uuid::new_v4().to_string();
    let mut active = channels.0.lock().await;
    active.retain(|_, pending| pending.expires > Instant::now() && pending.platform != platform);
    active.insert(
        id.clone(),
        PendingQr {
            platform,
            code,
            base,
            expires: Instant::now() + Duration::from_secs(expires_in),
        },
    );
    Ok(QrStart {
        id,
        url,
        expires_in,
        poll_interval,
    })
}

#[tauri::command]
pub async fn channel_qr_poll(
    state: State<'_, BackendState>,
    channels: State<'_, ChannelState>,
    id: String,
) -> Result<QrPoll, DesktopFailure> {
    let pending = channels
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or(DesktopFailure::invalid_input())?;
    if pending.expires <= Instant::now() {
        channels.0.lock().await.remove(&id);
        return Ok(QrPoll {
            status: "expired",
            restart_required: false,
        });
    }
    let result = if pending.platform == "feishu" {
        feishu_post(&[
            ("action", "poll"),
            ("device_code", &pending.code),
            ("tp", "ob_app"),
        ])
        .await?
    } else {
        let encoded: String = pending
            .code
            .bytes()
            .flat_map(|byte| {
                if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                    format!("{}", byte as char)
                } else {
                    format!("%{byte:02X}")
                }
                .into_bytes()
            })
            .map(char::from)
            .collect();
        weixin_request(
            &pending.base,
            &format!("ilink/bot/get_qrcode_status?qrcode={encoded}"),
        )?
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    };
    if pending.platform == "feishu" {
        if let (Some(app_id), Some(secret)) = (
            result.get("client_id").and_then(Value::as_str),
            result.get("client_secret").and_then(Value::as_str),
        ) {
            let domain = if result
                .pointer("/user_info/tenant_brand")
                .and_then(Value::as_str)
                == Some("lark")
            {
                "lark"
            } else {
                "feishu"
            };
            config_request(
                &state,
                reqwest::Method::PUT,
                "/api/messaging/platforms/feishu",
                Some(
                    json!({"enabled":true,"env":{"FEISHU_APP_ID":app_id,"FEISHU_APP_SECRET":secret,
                    "FEISHU_DOMAIN":domain}}),
                ),
            )
            .await?;
            channels.0.lock().await.remove(&id);
            return Ok(QrPoll {
                status: "connected",
                restart_required: true,
            });
        }
        if ["access_denied", "expired_token"]
            .contains(&result.get("error").and_then(Value::as_str).unwrap_or(""))
        {
            channels.0.lock().await.remove(&id);
            return Ok(QrPoll {
                status: "expired",
                restart_required: false,
            });
        }
    } else {
        match result
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("wait")
        {
            "scaned" => {
                return Ok(QrPoll {
                    status: "scanned",
                    restart_required: false,
                })
            }
            "expired" => {
                channels.0.lock().await.remove(&id);
                return Ok(QrPoll {
                    status: "expired",
                    restart_required: false,
                });
            }
            "scaned_but_redirect" => {
                if let Some(host) = result.get("redirect_host").and_then(Value::as_str) {
                    if valid_weixin_base(&format!("https://{host}")) {
                        if let Some(active) = channels.0.lock().await.get_mut(&id) {
                            active.base = format!("https://{host}");
                        }
                    }
                }
                return Ok(QrPoll {
                    status: "scanned",
                    restart_required: false,
                });
            }
            "confirmed" => {
                let account = result
                    .get("ilink_bot_id")
                    .and_then(Value::as_str)
                    .ok_or("微信未返回账号")?;
                let token = result
                    .get("bot_token")
                    .and_then(Value::as_str)
                    .ok_or("微信未返回令牌")?;
                let base = result
                    .get("baseurl")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(WEIXIN_BASE);
                if !valid_weixin_base(base) {
                    return Err(DesktopFailure::invalid_input());
                }
                config_request(&state, reqwest::Method::PUT, "/api/messaging/platforms/weixin",
                    Some(json!({"enabled":true,"env":{"WEIXIN_ACCOUNT_ID":account,"WEIXIN_TOKEN":token,
                        "WEIXIN_BASE_URL":base,"WEIXIN_DM_POLICY":"pairing",
                        "WEIXIN_GROUP_POLICY":"disabled"}}))).await?;
                channels.0.lock().await.remove(&id);
                return Ok(QrPoll {
                    status: "connected",
                    restart_required: true,
                });
            }
            _ => {}
        }
    }
    Ok(QrPoll {
        status: "waiting",
        restart_required: false,
    })
}

#[tauri::command]
pub async fn channel_qr_cancel(
    channels: State<'_, ChannelState>,
    id: String,
) -> Result<(), DesktopFailure> {
    channels.0.lock().await.remove(&id);
    Ok(())
}

#[cfg(test)]
#[path = "tests/channels.rs"]
mod tests;
