use super::{config::resolve_config_target, BackendState};
use crate::errors::DesktopFailure;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{multipart, Client, Method, Response, Url};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const MAX_STT_RESPONSE: usize = 2 * 1024 * 1024;
const MAX_TTS_RESPONSE: usize = 32 * 1024 * 1024;

fn field<'a>(config: &'a Value, name: &str) -> Result<&'a str, DesktopFailure> {
    config
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(DesktopFailure::operation_failed)
}

fn provider_url(base: &str, suffix: &[&str]) -> Result<Url, DesktopFailure> {
    let mut url = Url::parse(base).map_err(|_| DesktopFailure::operation_failed())?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(DesktopFailure::operation_failed());
    }
    url.path_segments_mut()
        .map_err(|_| DesktopFailure::operation_failed())?
        .pop_if_empty()
        .extend(suffix);
    Ok(url)
}

async fn response_bytes(mut response: Response, limit: usize) -> Result<Vec<u8>, DesktopFailure> {
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > limit as u64)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        if chunk.len() > limit - body.len() {
            return Err(DesktopFailure::operation_failed());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn client(timeout: Duration) -> Result<Client, DesktopFailure> {
    Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| DesktopFailure::operation_failed())
}

fn audio_bytes(data_url: &str, mime_type: &str) -> Result<Vec<u8>, DesktopFailure> {
    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(DesktopFailure::invalid_input)?;
    if header != format!("data:{mime_type};base64") {
        return Err(DesktopFailure::invalid_input());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| DesktopFailure::invalid_input())?;
    if bytes.is_empty() || bytes.len() > 20 * 1024 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(bytes)
}

fn transcription_text(wire: &str, body: &[u8]) -> Result<String, DesktopFailure> {
    let raw = std::str::from_utf8(body)
        .map_err(|_| DesktopFailure::operation_failed())?
        .trim();
    if wire == "openai-multipart" {
        if raw.starts_with('{') {
            if let Ok(value) = serde_json::from_str::<Value>(raw) {
                if let Some(text) = value.get("text").and_then(Value::as_str) {
                    return Ok(text.trim().to_owned());
                }
            }
        }
        return Ok(raw.to_owned());
    }
    let value: Value = serde_json::from_str(raw).map_err(|_| DesktopFailure::operation_failed())?;
    Ok(value
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned())
}

fn silence_hallucination(text: &str, config: &Value) -> bool {
    let Some(filter) = config.get("hallucination_filter") else {
        return false;
    };
    let cleaned = text.trim().to_lowercase();
    if cleaned.is_empty() {
        return true;
    }
    let stripped = cleaned.trim_end_matches(['.', '!']);
    if filter
        .get("phrases")
        .and_then(Value::as_array)
        .is_some_and(|phrases| {
            phrases
                .iter()
                .any(|phrase| phrase.as_str() == Some(stripped))
        })
    {
        return true;
    }
    filter
        .get("repeat_regex")
        .and_then(Value::as_str)
        .filter(|pattern| pattern.len() <= 256)
        .and_then(|pattern| {
            regex::RegexBuilder::new(pattern)
                .case_insensitive(true)
                .build()
                .ok()
        })
        .is_some_and(|pattern| pattern.is_match(&cleaned))
}

pub(super) async fn transcribe(
    state: &State<'_, BackendState>,
    profile: &str,
    data_url: &str,
    mime_type: &str,
) -> Result<Option<Value>, DesktopFailure> {
    let target = resolve_config_target(state, profile).await?;
    let Ok(config) = target
        .request(state, Method::GET, "/api/audio/voice-config", None)
        .await
    else {
        return Ok(None);
    };
    if config["ok"] != true {
        return Ok(None);
    }
    let stt = &config["stt"];
    if stt["mode"] != "direct" {
        return Ok(None);
    }
    let wire = field(stt, "wire")?;
    if !matches!(wire, "openai-multipart" | "xai-stt" | "elevenlabs-stt") {
        return Ok(None);
    }
    let suffix: &[&str] = match wire {
        "openai-multipart" => &["audio", "transcriptions"],
        "xai-stt" => &["stt"],
        _ => &["speech-to-text"],
    };
    let url = provider_url(field(stt, "base_url")?, suffix)?;
    let key = field(stt, "api_key")?;
    let timeout_s = stt["timeout_s"]
        .as_f64()
        .filter(|value| *value > 0.0 && *value <= 600.0)
        .unwrap_or(60.0);
    let bytes = audio_bytes(data_url, mime_type)?;
    let extension = mime_type
        .split(';')
        .next()
        .unwrap_or(mime_type)
        .split('/')
        .nth(1)
        .unwrap_or("webm");
    let extension = if extension == "mpeg" {
        "mp3"
    } else {
        extension
    };
    if extension.len() > 16 || !extension.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return Err(DesktopFailure::invalid_input());
    }
    let part = multipart::Part::bytes(bytes)
        .file_name(format!("recording.{extension}"))
        .mime_str(mime_type)
        .map_err(|_| DesktopFailure::invalid_input())?;
    let mut form = multipart::Form::new().part("file", part);
    if let Some(model) = stt["model"].as_str() {
        form = form.text(
            if wire == "elevenlabs-stt" {
                "model_id"
            } else {
                "model"
            },
            model.to_owned(),
        );
    }
    if let Some(language) = stt["language"].as_str().filter(|value| !value.is_empty()) {
        form = form.text(
            if wire == "elevenlabs-stt" {
                "language_code"
            } else {
                "language"
            },
            language.to_owned(),
        );
        if wire == "xai-stt" {
            form = form.text("format", "true");
        }
    }
    if wire == "openai-multipart" {
        form = form.text("response_format", "text");
    }
    let request = client(Duration::from_secs_f64(timeout_s))?
        .post(url)
        .multipart(form);
    let request = if wire == "elevenlabs-stt" {
        request.header("xi-api-key", key)
    } else {
        request.bearer_auth(key)
    };
    let response = request
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let body = response_bytes(response, MAX_STT_RESPONSE).await?;
    target.ensure_current(state).await?;
    let mut transcript = transcription_text(wire, &body)?;
    if silence_hallucination(&transcript, stt) {
        transcript.clear();
    }
    Ok(Some(
        json!({ "ok": true, "transcript": transcript, "provider": stt["provider"] }),
    ))
}

pub(super) async fn speak(
    state: &State<'_, BackendState>,
    profile: &str,
    text: &str,
) -> Result<Option<Value>, DesktopFailure> {
    let target = resolve_config_target(state, profile).await?;
    let Ok(config) = target
        .request(state, Method::GET, "/api/audio/voice-config", None)
        .await
    else {
        return Ok(None);
    };
    if config["ok"] != true {
        return Ok(None);
    }
    let tts = &config["tts"];
    if tts["mode"] != "direct" {
        return Ok(None);
    }
    let wire = field(tts, "wire")?;
    if !matches!(wire, "openai-speech" | "elevenlabs-tts") {
        return Ok(None);
    }
    let key = field(tts, "api_key")?;
    let base = field(tts, "base_url")?;
    let request = if wire == "openai-speech" {
        let url = provider_url(base, &["audio", "speech"])?;
        let mut body = tts["extra_body"].as_object().cloned().unwrap_or_default();
        body.insert("model".to_owned(), tts["model"].clone());
        body.insert("voice".to_owned(), tts["voice"].clone());
        body.insert("input".to_owned(), json!(text));
        body.insert("response_format".to_owned(), json!("mp3"));
        if let Some(speed) = tts["speed"]
            .as_f64()
            .filter(|speed| *speed > 0.0 && *speed != 1.0)
        {
            body.insert("speed".to_owned(), json!(speed));
        }
        client(Duration::from_secs(120))?
            .post(url)
            .bearer_auth(key)
            .json(&body)
    } else {
        let url = provider_url(base, &["text-to-speech", field(tts, "voice")?])?;
        client(Duration::from_secs(120))?
            .post(url)
            .header("xi-api-key", key)
            .header("Accept", "audio/mpeg")
            .json(&json!({ "text": text, "model_id": tts["model"] }))
    };
    let response = request
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let audio = response_bytes(response, MAX_TTS_RESPONSE).await?;
    target.ensure_current(state).await?;
    if audio.is_empty() {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(Some(json!({
        "ok": true,
        "data_url": format!("data:audio/mpeg;base64,{}", STANDARD.encode(audio)),
        "mime_type": "audio/mpeg",
        "provider": tts["provider"],
    })))
}

#[cfg(test)]
#[path = "tests/voice_direct.rs"]
mod tests;
