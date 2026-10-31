use super::{
    config::{config_request_for_scope, config_request_to_profile},
    profile_scope::ResolvedProfileScope,
    BackendState,
};
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
    profile: String,
    gateway_epoch: String,
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

fn channel_access_env(platform: &str, access: &str) -> Result<Value, DesktopFailure> {
    let allow_all = match access {
        "pairing" => "false",
        "open" => "true",
        _ => return Err(DesktopFailure::invalid_input()),
    };
    match platform {
        "feishu" => Ok(json!({"FEISHU_ALLOW_ALL_USERS": allow_all})),
        "weixin" => Ok(
            json!({"WEIXIN_DM_POLICY": access, "WEIXIN_ALLOW_ALL_USERS": allow_all,
            "WEIXIN_GROUP_POLICY": "disabled"}),
        ),
        _ => Err(DesktopFailure::invalid_input()),
    }
}

async fn save_access_flag(
    state: &State<'_, BackendState>,
    scope: &ResolvedProfileScope,
    platform: &str,
    access_env: &Value,
) -> Result<(), DesktopFailure> {
    let key = if platform == "feishu" {
        "FEISHU_ALLOW_ALL_USERS"
    } else {
        "WEIXIN_ALLOW_ALL_USERS"
    };
    let value = access_env[key]
        .as_str()
        .ok_or(DesktopFailure::invalid_input())?;
    let result = config_request_for_scope(
        state,
        scope,
        reqwest::Method::PUT,
        "/api/env",
        Some(json!({"profile": scope.profile, "key": key, "value": value})),
    )
    .await?;
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(())
    } else {
        Err(DesktopFailure::operation_failed())
    }
}

#[tauri::command]
pub async fn channel_status(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let whatsapp_linked = super::channel_manage::whatsapp_session_linked(&scope.home);
    let result = config_request_to_profile(
        &state,
        &profile,
        reqwest::Method::GET,
        "/api/messaging/platforms",
        None,
    )
    .await?;
    scope.ensure_current(&state).await?;
    // Never return the dashboard's environment fields to the WebView.
    let platforms = result
        .get("platforms")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(
        json!({"platforms": platforms.iter().filter(|p| p.get("id").and_then(Value::as_str).is_some())
        .map(|p| json!({"id": p.get("id"), "name": p.get("name"), "enabled": p.get("enabled"),
            "supported": !(cfg!(windows) && p.get("id").and_then(Value::as_str) == Some("matrix")),
            "configured": if p.get("id").and_then(Value::as_str) == Some("whatsapp") { json!(whatsapp_linked) } else { p.get("configured").cloned().unwrap_or(Value::Bool(false)) }, "state": p.get("state"),
            "error_code": p.get("error_code"),
            "fields": p.get("env_vars").and_then(Value::as_array).map(|fields| fields.iter().map(|field| json!({
                "key": field.get("key"), "prompt": field.get("prompt"), "help": field.get("help"),
                "required": field.get("required"), "is_set": field.get("is_set"),
                "is_password": field.get("is_password"), "is_list": field.get("is_list"),
                "value": if field.get("is_list").and_then(Value::as_bool) == Some(true) { field.get("value") } else { None }
            })).collect::<Vec<_>>())})).collect::<Vec<_>>() }),
    )
}

#[tauri::command]
pub async fn channel_pairing_approve(
    state: State<'_, BackendState>,
    profile: String,
    platform: String,
    code: String,
) -> Result<(), DesktopFailure> {
    if platform.is_empty()
        || platform.len() > 64
        || !platform.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
    {
        return Err(DesktopFailure::invalid_input());
    }
    let code: String = code
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();
    if code.len() != 8
        || !code
            .bytes()
            .all(|byte| b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&byte))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(&scope.storage,
        &format!("channel_pairing_approve_start operation={operation} profile={profile} platform={platform}"));
    let result = async {
        scope.ensure_current(&state).await?;
        let (port, auth_header, token) = scope.http_auth().await?;
        scope.ensure_current(&state).await?;
        let response = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| DesktopFailure::connection_lost())?
            .post(format!("http://127.0.0.1:{port}/api/pairing/approve"))
            .header(auth_header, token)
            .json(&json!({"profile": profile, "platform": platform, "code": code}))
            .send()
            .await
            .map_err(|_| DesktopFailure::connection_lost())?;
        scope.ensure_current(&state).await?;
        match response.status().as_u16() {
            200 => Ok(()),
            404 => Err(DesktopFailure::pairing_not_found()),
            429 => Err(DesktopFailure::pairing_locked()),
            _ => Err(DesktopFailure::operation_failed()),
        }
    }
    .await;
    let outcome = if result.is_ok() {
        "completed"
    } else {
        "failed"
    };
    let _ = crate::diagnostics::append_client_event(&scope.storage,
        &format!("channel_pairing_approve_{outcome} operation={operation} profile={profile} platform={platform}"));
    result
}

#[tauri::command]
pub async fn channel_qr_start(
    state: State<'_, BackendState>,
    channels: State<'_, ChannelState>,
    profile: String,
    platform: String,
) -> Result<QrStart, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
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
    scope.ensure_current(&state).await?;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("channel_qr_started operation={id} profile={profile} platform={platform}"),
    );
    let mut active = channels.0.lock().await;
    active.retain(|_, pending| {
        pending.expires > Instant::now()
            && (pending.platform != platform || pending.profile != profile)
    });
    active.insert(
        id.clone(),
        PendingQr {
            profile,
            gateway_epoch: scope.gateway_epoch,
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
    profile: String,
    id: String,
    access: String,
) -> Result<QrPoll, DesktopFailure> {
    let access_env = {
        let pending = channels.0.lock().await;
        let request = pending.get(&id).ok_or(DesktopFailure::invalid_input())?;
        channel_access_env(&request.platform, &access)?
    };
    let pending = channels
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or(DesktopFailure::invalid_input())?;
    if profile != pending.profile {
        return Err(DesktopFailure::conflict());
    }
    let scope = state.resolve_profile(&profile).await?;
    if pending.gateway_epoch != scope.gateway_epoch {
        channels.0.lock().await.remove(&id);
        return Err(DesktopFailure::conflict());
    }
    if pending.expires <= Instant::now() {
        channels.0.lock().await.remove(&id);
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "channel_qr_expired operation={id} profile={profile} platform={}",
                pending.platform
            ),
        );
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
            let _ = crate::diagnostics::append_client_event(&scope.storage,
                &format!("channel_qr_confirmed operation={id} profile={profile} platform=feishu access={access}"));
            if let Err(error) = save_access_flag(&state, &scope, "feishu", &access_env).await {
                let _ = crate::diagnostics::append_client_event(&scope.storage,
                    &format!("channel_qr_flag_failed operation={id} profile={profile} platform=feishu access={access}"));
                return Err(error);
            }
            let saved = config_request_for_scope(
                &state,
                &scope,
                reqwest::Method::PUT,
                "/api/messaging/platforms/feishu",
                Some(
                    json!({"enabled":true,"profile": profile,"env":{"FEISHU_APP_ID":app_id,"FEISHU_APP_SECRET":secret,
                    "FEISHU_DOMAIN":domain}, "clear_env": ["FEISHU_ALLOWED_USERS"]}),
                ),
            )
            .await;
            if let Err(error) = saved {
                let _ = crate::diagnostics::append_client_event(&scope.storage,
                    &format!("channel_qr_config_failed operation={id} profile={profile} platform=feishu access={access}"));
                return Err(error);
            }
            let _ = crate::diagnostics::append_client_event(&scope.storage,
                &format!("channel_qr_completed operation={id} profile={profile} platform=feishu access={access}"));
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
            let _ = crate::diagnostics::append_client_event(
                &scope.storage,
                &format!("channel_qr_expired operation={id} profile={profile} platform=feishu"),
            );
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
                let _ = crate::diagnostics::append_client_event(
                    &scope.storage,
                    &format!("channel_qr_expired operation={id} profile={profile} platform=weixin"),
                );
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
                let _ = crate::diagnostics::append_client_event(&scope.storage,
                    &format!("channel_qr_confirmed operation={id} profile={profile} platform=weixin access={access}"));
                if let Err(error) = save_access_flag(&state, &scope, "weixin", &access_env).await {
                    let _ = crate::diagnostics::append_client_event(&scope.storage,
                        &format!("channel_qr_flag_failed operation={id} profile={profile} platform=weixin access={access}"));
                    return Err(error);
                }
                let saved = config_request_for_scope(&state, &scope, reqwest::Method::PUT, "/api/messaging/platforms/weixin",
                    Some(json!({"enabled":true,"profile": profile,"env":{"WEIXIN_ACCOUNT_ID":account,"WEIXIN_TOKEN":token,
                        "WEIXIN_BASE_URL":base,"WEIXIN_DM_POLICY": access_env["WEIXIN_DM_POLICY"],
                        "WEIXIN_GROUP_POLICY":"disabled"},
                        "clear_env": ["WEIXIN_ALLOWED_USERS"]}))).await;
                if let Err(error) = saved {
                    let _ = crate::diagnostics::append_client_event(&scope.storage,
                        &format!("channel_qr_config_failed operation={id} profile={profile} platform=weixin access={access}"));
                    return Err(error);
                }
                let _ = crate::diagnostics::append_client_event(&scope.storage,
                    &format!("channel_qr_completed operation={id} profile={profile} platform=weixin access={access}"));
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
    state: State<'_, BackendState>,
    channels: State<'_, ChannelState>,
    profile: String,
    id: String,
) -> Result<(), DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let mut pending = channels.0.lock().await;
    if pending
        .get(&id)
        .is_some_and(|request| request.profile != profile)
    {
        return Err(DesktopFailure::conflict());
    }
    if let Some(request) = pending.remove(&id) {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "channel_qr_cancelled operation={id} profile={profile} platform={}",
                request.platform
            ),
        );
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/channels.rs"]
mod tests;
