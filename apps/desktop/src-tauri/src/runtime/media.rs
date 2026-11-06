use super::{
    media_files, media_protocol,
    media_source::{self, HttpSource, MediaOwner, MediaSource, MAX_DOWNLOAD},
    BackendState,
};
use crate::{diagnostics::log_client_event, errors::DesktopFailure};
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Manager, State, UriSchemeResponder, WebviewWindow};
use uuid::Uuid;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaScope {
    pub profile: String,
    pub session_id: String,
    pub gateway_epoch: String,
}

#[derive(Clone, Serialize)]
pub struct MediaResource {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub mime: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    pub local: bool,
}

pub(super) struct MediaEntry {
    pub resource: MediaResource,
    pub owner: MediaOwner,
    pub window: String,
    pub source: MediaSource,
    pub released: AtomicBool,
    pub cancel: tokio::sync::Notify,
}

impl MediaEntry {
    pub(super) async fn cancelled(&self) {
        let notification = self.cancel.notified();
        tokio::pin!(notification);
        notification.as_mut().enable();
        if !self.released.load(Ordering::Acquire) {
            notification.await;
        }
    }
    pub async fn ensure_current(&self, state: &BackendState) -> Result<(), DesktopFailure> {
        if self.released.load(Ordering::Acquire) {
            return Err(DesktopFailure::conflict());
        }
        self.owner.ensure_current(state).await
    }
}

#[derive(Default)]
pub struct MediaResources(Mutex<HashMap<String, Arc<MediaEntry>>>);

impl MediaResources {
    fn release(&self, id: &str, window: &str) -> Result<(), DesktopFailure> {
        let mut entries = self
            .0
            .lock()
            .map_err(|_| DesktopFailure::operation_failed())?;
        if entries.get(id).is_some_and(|entry| entry.window != window) {
            return Err(DesktopFailure::invalid_input());
        }
        if let Some(entry) = entries.remove(id) {
            entry.released.store(true, Ordering::Release);
            entry.cancel.notify_waiters();
            log_client_event(&format!("chat_media_released resource={id}"));
        }
        Ok(())
    }
    pub(super) fn get(&self, id: &str, window: &str) -> Result<Arc<MediaEntry>, DesktopFailure> {
        let entries = self
            .0
            .lock()
            .map_err(|_| DesktopFailure::operation_failed())?;
        entries
            .get(id)
            .filter(|entry| entry.window == window && !entry.released.load(Ordering::Acquire))
            .cloned()
            .ok_or_else(DesktopFailure::invalid_input)
    }

    fn insert(&self, entry: MediaEntry) -> Result<MediaResource, DesktopFailure> {
        let mut entries = self
            .0
            .lock()
            .map_err(|_| DesktopFailure::operation_failed())?;
        if entries
            .values()
            .filter(|e| e.window == entry.window)
            .count()
            >= 512
        {
            return Err(DesktopFailure::conflict());
        }
        let result = entry.resource.clone();
        entries.insert(result.id.clone(), Arc::new(entry));
        Ok(result)
    }
}

fn valid_source(source: &str) -> bool {
    !source.is_empty()
        && source.len() <= media_source::MAX_INLINE * 4 / 3 + 1024
        && !source.chars().any(char::is_control)
}

async fn prepare(
    state: &BackendState,
    app: &AppHandle,
    window: &str,
    scope: MediaScope,
    mut source: String,
    id: String,
) -> Result<MediaEntry, DesktopFailure> {
    if !valid_source(&source) {
        return Err(DesktopFailure::invalid_input());
    }
    for scheme in ["http:", "https:", "file:", "data:"] {
        if source
            .get(..scheme.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme))
        {
            source.replace_range(..scheme.len(), scheme);
            break;
        }
    }
    let (owner, endpoint, cwd) = media_source::resolve_owner(app, state, scope).await?;
    let name = if source.starts_with("data:") {
        "inline".to_owned()
    } else {
        media_source::source_name(&source)
    };
    let (kind, mime) = media_source::mime_for(&name);
    let mut resource = MediaResource {
        id,
        name,
        kind: kind.into(),
        mime: mime.into(),
        size: None,
        local: false,
    };
    let media = if source.starts_with("data:") {
        let (data, mime, kind) = media_source::data_source(&source)?;
        resource.mime = mime;
        resource.kind = kind.into();
        resource.name = format!(
            "inline.{}",
            resource
                .mime
                .split('/')
                .nth(1)
                .unwrap_or("media")
                .split('+')
                .next()
                .unwrap_or("media")
        );
        if let MediaSource::Data(bytes) = &data {
            resource.size = Some(bytes.len() as u64);
        }
        data
    } else if source.starts_with("http://") || source.starts_with("https://") {
        let url = Url::parse(&source).map_err(|_| DesktopFailure::invalid_input())?;
        if !url.username().is_empty() || url.password().is_some() {
            return Err(DesktopFailure::invalid_input());
        }
        // A URL in model text never inherits Gateway credentials.
        MediaSource::Http(HttpSource { url, auth: None })
    } else {
        let windows_path = source.as_bytes().get(1) == Some(&b':')
            && source
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic);
        if windows_path
            && !source
                .as_bytes()
                .get(2)
                .is_some_and(|b| matches!(b, b'/' | b'\\'))
        {
            return Err(DesktopFailure::invalid_input());
        }
        if windows_path || source.starts_with(r"\\") {
            let normalized = crate::paths::plain_path(std::path::Path::new(&source));
            media_source::validate_local_path_type(&normalized)?;
            source = normalized.to_string_lossy().into_owned();
        }
        if !windows_path && !source.starts_with("file:") && Url::parse(&source).is_ok() {
            return Err(DesktopFailure::invalid_input());
        }
        if owner.remote {
            if source.len() > 32768 {
                return Err(DesktopFailure::invalid_input());
            }
            // Keep remote paths in the remote OS spelling. The Gateway resolves session-relative paths.
            MediaSource::Http(HttpSource {
                url: media_source::gateway_url(
                    &owner.base_url,
                    "download",
                    &source,
                    &owner.scope.profile,
                    &owner.scope.session_id,
                )?,
                auth: endpoint.auth,
            })
        } else {
            let path = media_source::local_path(&source, &cwd)?;
            resource.name = path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or(resource.name);
            resource.size = Some(
                std::fs::metadata(crate::paths::filesystem_path(&path))
                    .map_err(|_| DesktopFailure::operation_failed())?
                    .len(),
            );
            resource.local = true;
            MediaSource::Local(path)
        }
    };
    if let MediaSource::Http(http) = &media {
        let response = http
            .request(Method::GET)?
            .header("Range", "bytes=0-0")
            .send()
            .await
            .map_err(|_| DesktopFailure::connection_lost())?;
        let empty_file = response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE
            && response
                .headers()
                .get("content-range")
                .and_then(|h| h.to_str().ok())
                == Some("bytes */0");
        if !response.status().is_success() && !empty_file {
            return Err(DesktopFailure::operation_failed());
        }
        resource.size = response
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.rsplit('/').next())
            .and_then(|s| s.parse().ok())
            .or_else(|| {
                if response.status() == reqwest::StatusCode::OK {
                    response.content_length()
                } else {
                    None
                }
            });
        if let Some(mime) = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.split(';').next().unwrap_or("").trim())
        {
            // Extensionless public URLs still carry a usable image/audio/video content type.
            if resource.kind == "file"
                && ["image/", "audio/", "video/"]
                    .iter()
                    .any(|prefix| mime.starts_with(prefix))
            {
                resource.kind = mime.split('/').next().unwrap_or("file").to_owned();
                resource.mime = mime.to_owned();
            } else if resource.kind == "file"
                && matches!(mime, "application/pdf" | "text/html" | "text/plain")
            {
                resource.mime = mime.to_owned();
            }
        }
    }
    if resource.size.is_some_and(|size| size > MAX_DOWNLOAD) {
        return Err(DesktopFailure::invalid_input());
    }
    owner.ensure_current(state).await?;
    Ok(MediaEntry {
        resource,
        owner,
        window: window.to_owned(),
        source: media,
        released: AtomicBool::new(false),
        cancel: tokio::sync::Notify::new(),
    })
}

#[tauri::command]
pub async fn prepare_chat_media(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, BackendState>,
    resources: State<'_, MediaResources>,
    scope: MediaScope,
    source: String,
) -> Result<MediaResource, DesktopFailure> {
    let id = Uuid::new_v4().to_string();
    log_client_event(&format!("chat_media_prepare_started resource={id}"));
    let result = match prepare(&state, &app, window.label(), scope, source, id.clone()).await {
        Ok(entry) if app.get_webview_window(window.label()).is_some() => resources.insert(entry),
        Ok(_) => Err(DesktopFailure::conflict()),
        Err(error) => Err(error),
    };
    log_client_event(&format!(
        "{}chat_media_prepare_{} resource={id}",
        if result.is_err() { "ERROR " } else { "" },
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        }
    ));
    result
}

#[derive(Serialize)]
pub struct MediaPreview {
    pub kind: &'static str,
    pub content: String,
    pub truncated: bool,
}

#[tauri::command]
pub async fn preview_chat_media(
    window: WebviewWindow,
    state: State<'_, BackendState>,
    resources: State<'_, MediaResources>,
    id: String,
) -> Result<MediaPreview, DesktopFailure> {
    let entry = resources.get(&id, window.label())?;
    log_client_event(&format!("chat_media_preview_started resource={id}"));
    let result = tokio::select! {
        result = media_files::preview(&entry, &state) => result,
        _ = entry.cancelled() => Err(DesktopFailure::conflict()),
    };
    log_client_event(&format!(
        "{}chat_media_preview_{} resource={id}",
        if result.is_err() { "ERROR " } else { "" },
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        }
    ));
    result
}

#[tauri::command]
pub async fn save_chat_media(
    window: WebviewWindow,
    state: State<'_, BackendState>,
    resources: State<'_, MediaResources>,
    id: String,
    destination: String,
) -> Result<(), DesktopFailure> {
    let entry = resources.get(&id, window.label())?;
    log_client_event(&format!("chat_media_save_started resource={id}"));
    let result = tokio::select! {
        result = media_files::save(&entry, &state, &destination) => result,
        _ = entry.cancelled() => Err(DesktopFailure::conflict()),
    };
    log_client_event(&format!(
        "{}chat_media_save_{} resource={id}",
        if result.is_err() { "ERROR " } else { "" },
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        }
    ));
    result
}

#[tauri::command]
pub async fn reveal_chat_media(
    window: WebviewWindow,
    state: State<'_, BackendState>,
    resources: State<'_, MediaResources>,
    id: String,
) -> Result<(), DesktopFailure> {
    let entry = resources.get(&id, window.label())?;
    log_client_event(&format!("chat_media_reveal_started resource={id}"));
    let result = async {
        entry.ensure_current(&state).await?;
        let MediaSource::Local(path) = &entry.source else {
            return Err(DesktopFailure::invalid_input());
        };
        let checked = media_source::local_path(&path.to_string_lossy(), "")?;
        tauri_plugin_opener::reveal_item_in_dir(checked)
            .map_err(|_| DesktopFailure::operation_failed())?;
        entry.ensure_current(&state).await
    }
    .await;
    log_client_event(&format!(
        "{}chat_media_reveal_{} resource={id}",
        if result.is_err() { "ERROR " } else { "" },
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        }
    ));
    result
}

#[tauri::command]
pub fn release_chat_media(
    window: WebviewWindow,
    resources: State<'_, MediaResources>,
    id: String,
) -> Result<(), DesktopFailure> {
    resources.release(&id, window.label())
}

pub fn release_window(app: &AppHandle, label: &str) {
    let resources = app.state::<MediaResources>();
    if let Ok(mut entries) = resources.0.lock() {
        let before = entries.len();
        entries.retain(|_, entry| {
            if entry.window == label {
                entry.released.store(true, Ordering::Release);
                entry.cancel.notify_waiters();
                false
            } else {
                true
            }
        });
        let count = before - entries.len();
        if count > 0 {
            log_client_event(&format!("chat_media_window_released count={count}"));
        }
    };
}

pub fn handle_protocol(
    app: AppHandle,
    window_label: String,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    tauri::async_runtime::spawn(async move {
        let result = media_protocol::respond(&app, &window_label, request).await;
        responder.respond(result);
    });
}

#[cfg(test)]
#[path = "tests/media.rs"]
mod tests;
