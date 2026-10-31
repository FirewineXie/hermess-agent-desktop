//! QR registration for channels whose locked fork already documents vendor device flows.
use super::{config::config_request_for_scope, BackendState};
use crate::errors::DesktopFailure;
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use reqwest::{Client, Method, Url};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
pub struct VendorQrState(Mutex<HashMap<String, Pending>>);

#[derive(Clone)]
struct Pending {
    profile: String,
    epoch: String,
    platform: String,
    code: String,
    qq_key: Option<[u8; 32]>,
    credentials: Option<Value>,
    expires: Instant,
}

fn client() -> Result<Client, DesktopFailure> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| DesktopFailure::connection_lost())
}

async fn request(method: Method, url: &str, body: Option<Value>) -> Result<Value, DesktopFailure> {
    let mut builder = client()?
        .request(method, url)
        .header("Accept", "application/json");
    if url.starts_with("https://q.qq.com/") {
        builder = builder.header("User-Agent", "QQBotAdapter/1.1.0 (HermessDesktop/0.1.9)");
    }
    if let Some(body) = body {
        builder = builder.json(&body);
    }
    let response = builder
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    if !response.status().is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    response
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())
}

fn valid_qr_url(raw: &str, platform: &str) -> Result<String, DesktopFailure> {
    let url = Url::parse(raw).map_err(|_| DesktopFailure::operation_failed())?;
    let host = url.host_str().unwrap_or("");
    let valid = match platform {
        "dingtalk" => host == "dingtalk.com" || host.ends_with(".dingtalk.com"),
        "wecom" => host == "work.weixin.qq.com",
        "qqbot" => host == "q.qq.com",
        _ => false,
    };
    if url.scheme() != "https" || !valid || url.username() != "" || url.password().is_some() {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(raw.to_owned())
}

fn nonempty<'a>(value: &'a Value, key: &str) -> Result<&'a str, DesktopFailure> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .ok_or_else(DesktopFailure::operation_failed)
}

fn decrypt_qq_secret(encrypted: &str, key: &[u8; 32]) -> Result<String, DesktopFailure> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encrypted)
        .map_err(|_| DesktopFailure::operation_failed())?;
    if raw.len() < 29 {
        return Err(DesktopFailure::operation_failed());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| DesktopFailure::operation_failed())?;
    let plain = cipher
        .decrypt(Nonce::from_slice(&raw[..12]), &raw[12..])
        .map_err(|_| DesktopFailure::operation_failed())?;
    String::from_utf8(plain).map_err(|_| DesktopFailure::operation_failed())
}

#[tauri::command]
pub async fn channel_vendor_qr_start(
    state: State<'_, BackendState>,
    setups: State<'_, VendorQrState>,
    profile: String,
    platform: String,
) -> Result<Value, DesktopFailure> {
    if !["dingtalk", "wecom", "qqbot"].contains(&platform.as_str()) {
        return Err(DesktopFailure::invalid_input());
    }
    let scope = state.resolve_profile(&profile).await?;
    let operation = Uuid::new_v4();
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_vendor_qr_start operation={operation} profile={profile} platform={platform}"
        ),
    );
    let result: Result<Value, DesktopFailure> = async {
        let mut qq_key = None;
        let (code, url, lifetime, poll_interval) = if platform == "dingtalk" {
            let init = request(
                Method::POST,
                "https://oapi.dingtalk.com/app/registration/init",
                Some(json!({"source": "openClaw"})),
            )
            .await?;
            if init.get("errcode").and_then(Value::as_i64) != Some(0) {
                return Err(DesktopFailure::operation_failed());
            }
            let begin = request(
                Method::POST,
                "https://oapi.dingtalk.com/app/registration/begin",
                Some(json!({"nonce": nonempty(&init, "nonce")?})),
            )
            .await?;
            if begin.get("errcode").and_then(Value::as_i64) != Some(0) {
                return Err(DesktopFailure::operation_failed());
            }
            (
                nonempty(&begin, "device_code")?.to_owned(),
                valid_qr_url(nonempty(&begin, "verification_uri_complete")?, &platform)?,
                begin
                    .get("expires_in")
                    .and_then(Value::as_u64)
                    .unwrap_or(7200)
                    .min(7200),
                begin
                    .get("interval")
                    .and_then(Value::as_u64)
                    .unwrap_or(3)
                    .clamp(2, 30),
            )
        } else if platform == "wecom" {
            let init = request(
                Method::GET,
                "https://work.weixin.qq.com/ai/qc/generate?source=hermes",
                None,
            )
            .await?;
            let data = init
                .get("data")
                .ok_or_else(DesktopFailure::operation_failed)?;
            (
                nonempty(data, "scode")?.to_owned(),
                valid_qr_url(nonempty(data, "auth_url")?, &platform)?,
                300,
                3,
            )
        } else {
            let generated = Aes256Gcm::generate_key(&mut OsRng);
            let mut key = [0u8; 32];
            key.copy_from_slice(&generated);
            let encoded = base64::engine::general_purpose::STANDARD.encode(key);
            let init = request(
                Method::POST,
                "https://q.qq.com/lite/create_bind_task",
                Some(json!({"key": encoded})),
            )
            .await?;
            if init.get("retcode").and_then(Value::as_i64) != Some(0) {
                return Err(DesktopFailure::operation_failed());
            }
            let task_id = nonempty(
                init.get("data")
                    .ok_or_else(DesktopFailure::operation_failed)?,
                "task_id",
            )?;
            let mut qr = Url::parse("https://q.qq.com/qqbot/openclaw/connect.html")
                .map_err(|_| DesktopFailure::operation_failed())?;
            qr.query_pairs_mut()
                .append_pair("task_id", task_id)
                .append_pair("_wv", "2")
                .append_pair("source", "hermes");
            qq_key = Some(key);
            (
                task_id.to_owned(),
                valid_qr_url(qr.as_str(), &platform)?,
                600,
                2,
            )
        };
        scope.ensure_current(&state).await?;
        if code.len() > 4096 {
            return Err(DesktopFailure::operation_failed());
        }
        let id = Uuid::new_v4().to_string();
        let mut records = setups.0.lock().await;
        records.retain(|_, pending| {
            pending.expires > Instant::now()
                && (pending.profile != profile || pending.platform != platform)
        });
        records.insert(
            id.clone(),
            Pending {
                profile: profile.clone(),
                epoch: scope.gateway_epoch.clone(),
                platform: platform.clone(),
                code,
                qq_key,
                credentials: None,
                expires: Instant::now() + Duration::from_secs(lifetime),
            },
        );
        Ok(json!({"id": id, "url": url, "poll_interval": poll_interval}))
    }
    .await;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_vendor_qr_start_{} operation={operation} pairing={} profile={profile} platform={platform}",
            if result.is_ok() { "completed" } else { "failed" }
            , result.as_ref().ok().and_then(|body| body.get("id")).and_then(Value::as_str).unwrap_or("-")
        ),
    );
    result
}

#[tauri::command]
pub async fn channel_vendor_qr_poll(
    state: State<'_, BackendState>,
    setups: State<'_, VendorQrState>,
    profile: String,
    id: String,
) -> Result<Value, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let pending = setups
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)?;
    if pending.profile != profile || pending.epoch != scope.gateway_epoch {
        return Err(DesktopFailure::conflict());
    }
    if pending.expires <= Instant::now() {
        setups.0.lock().await.remove(&id);
        return Ok(json!({"status": "expired"}));
    }
    if pending.credentials.is_some() {
        return Ok(json!({"status": "ready"}));
    }
    let credentials = if pending.platform == "dingtalk" {
        let result = request(
            Method::POST,
            "https://oapi.dingtalk.com/app/registration/poll",
            Some(json!({"device_code": pending.code})),
        )
        .await?;
        if result.get("errcode").and_then(Value::as_i64) != Some(0) {
            return Err(DesktopFailure::operation_failed());
        }
        match result.get("status").and_then(Value::as_str) {
            Some("SUCCESS") => Some(
                json!({"DINGTALK_CLIENT_ID": nonempty(&result, "client_id")?,
                "DINGTALK_CLIENT_SECRET": nonempty(&result, "client_secret")?}),
            ),
            Some("EXPIRED") => {
                setups.0.lock().await.remove(&id);
                return Ok(json!({"status":"expired"}));
            }
            _ => None,
        }
    } else if pending.platform == "wecom" {
        let mut url = Url::parse("https://work.weixin.qq.com/ai/qc/query_result")
            .map_err(|_| DesktopFailure::operation_failed())?;
        url.query_pairs_mut().append_pair("scode", &pending.code);
        let result = request(Method::GET, url.as_str(), None).await?;
        let data = result
            .get("data")
            .ok_or_else(DesktopFailure::operation_failed)?;
        if data.get("status").and_then(Value::as_str) == Some("success") {
            let info = data
                .get("bot_info")
                .ok_or_else(DesktopFailure::operation_failed)?;
            let bot_id = info
                .get("botid")
                .or_else(|| info.get("bot_id"))
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .ok_or_else(DesktopFailure::operation_failed)?;
            Some(json!({"WECOM_BOT_ID": bot_id, "WECOM_SECRET": nonempty(info, "secret")?}))
        } else {
            None
        }
    } else {
        let result = request(
            Method::POST,
            "https://q.qq.com/lite/poll_bind_result",
            Some(json!({"task_id": pending.code})),
        )
        .await?;
        if result.get("retcode").and_then(Value::as_i64) != Some(0) {
            return Err(DesktopFailure::operation_failed());
        }
        let data = result
            .get("data")
            .ok_or_else(DesktopFailure::operation_failed)?;
        match data.get("status").and_then(Value::as_i64) {
            Some(2) => {
                let key = pending
                    .qq_key
                    .ok_or_else(DesktopFailure::operation_failed)?;
                let secret = decrypt_qq_secret(nonempty(data, "bot_encrypt_secret")?, &key)?;
                let openid = data
                    .get("user_openid")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                Some(
                    json!({"QQ_APP_ID": nonempty(data, "bot_appid")?, "QQ_CLIENT_SECRET": secret,
                    "QQ_ALLOWED_USERS": openid}),
                )
            }
            Some(3) => {
                setups.0.lock().await.remove(&id);
                return Ok(json!({"status":"expired"}));
            }
            _ => None,
        }
    };
    scope.ensure_current(&state).await?;
    if let Some(credentials) = credentials {
        let mut records = setups.0.lock().await;
        let record = records.get_mut(&id).ok_or_else(DesktopFailure::conflict)?;
        record.credentials = Some(credentials);
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "channel_vendor_qr_ready operation={id} profile={profile} platform={}",
                pending.platform
            ),
        );
        Ok(json!({"status":"ready"}))
    } else {
        Ok(json!({"status":"waiting"}))
    }
}

#[cfg(test)]
#[path = "tests/channel_vendor_qr.rs"]
mod tests;

#[tauri::command]
pub async fn channel_vendor_qr_apply(
    state: State<'_, BackendState>,
    setups: State<'_, VendorQrState>,
    profile: String,
    id: String,
) -> Result<(), DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let pending = setups
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(DesktopFailure::invalid_input)?;
    if pending.profile != profile || pending.epoch != scope.gateway_epoch {
        return Err(DesktopFailure::conflict());
    }
    if pending.expires <= Instant::now() {
        return Err(DesktopFailure::invalid_input());
    }
    let credentials = pending.credentials.ok_or_else(DesktopFailure::conflict)?;
    let response = config_request_for_scope(
        &state,
        &scope,
        Method::PUT,
        &format!("/api/messaging/platforms/{}", pending.platform),
        Some(json!({"profile":profile, "enabled":true, "env":credentials, "clear_env":[]})),
    )
    .await;
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!(
            "channel_vendor_qr_apply_{} operation={id} profile={profile} platform={}",
            if response
                .as_ref()
                .is_ok_and(|body| body.get("ok").and_then(Value::as_bool) == Some(true))
            {
                "completed"
            } else {
                "failed"
            },
            pending.platform
        ),
    );
    if response?.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(DesktopFailure::operation_failed());
    }
    setups.0.lock().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn channel_vendor_qr_cancel(
    state: State<'_, BackendState>,
    setups: State<'_, VendorQrState>,
    profile: String,
    id: String,
) -> Result<(), DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    let mut records = setups.0.lock().await;
    if let Some(record) = records.get(&id) {
        if record.profile != profile || record.epoch != scope.gateway_epoch {
            return Err(DesktopFailure::conflict());
        }
    }
    records.remove(&id);
    let _ = crate::diagnostics::append_client_event(
        &scope.storage,
        &format!("channel_vendor_qr_cancel operation={id} profile={profile}"),
    );
    Ok(())
}
