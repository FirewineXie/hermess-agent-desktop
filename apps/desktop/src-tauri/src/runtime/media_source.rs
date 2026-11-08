use super::{media::MediaScope, remote_config, BackendState};
use crate::{
    errors::DesktopFailure,
    gateway::GatewayClient,
    paths::{filesystem_path, plain_path, CanonicalizePlain},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{Client, Method, Url};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::AppHandle;

pub(super) const MAX_INLINE: usize = 32 * 1024 * 1024;
pub(super) const MAX_PREVIEW: usize = 2 * 1024 * 1024;
pub(super) const MAX_HTML_PREVIEW: usize = 20 * 1024 * 1024;
pub(super) const MAX_CHUNK: u64 = 4 * 1024 * 1024;
pub(super) const MAX_DOWNLOAD: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct HttpSource {
    pub url: Url,
    pub auth: Option<(&'static str, String)>,
}

impl HttpSource {
    pub fn request(&self, method: Method) -> Result<reqwest::RequestBuilder, DesktopFailure> {
        let redirect = if self.auth.is_some() {
            reqwest::redirect::Policy::none()
        } else {
            reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5
                    || !matches!(attempt.url().scheme(), "http" | "https")
                    || !attempt.url().username().is_empty()
                    || attempt.url().password().is_some()
                {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            })
        };
        let mut builder = Client::builder()
            .redirect(redirect)
            .referer(false)
            .connect_timeout(Duration::from_secs(15));
        if self.auth.is_some()
            || matches!(
                self.url.host_str(),
                Some("127.0.0.1" | "localhost" | "[::1]")
            )
        {
            builder = builder.no_proxy();
        }
        let client = builder
            .build()
            .map_err(|_| DesktopFailure::operation_failed())?;
        let mut request = client
            .request(method, self.url.clone())
            .timeout(Duration::from_secs(60));
        if let Some((name, value)) = &self.auth {
            request = request.header(*name, value);
        }
        Ok(request)
    }
}

#[derive(Clone)]
pub(super) enum MediaSource {
    Local(PathBuf),
    Http(HttpSource),
    Data(Arc<Vec<u8>>),
}

pub(super) struct MediaOwner {
    pub scope: MediaScope,
    pub client: Arc<GatewayClient>,
    pub remote: bool,
    pub base_url: String,
}

impl MediaOwner {
    pub async fn ensure_current(&self, state: &BackendState) -> Result<(), DesktopFailure> {
        if self.client.is_closed() {
            return Err(DesktopFailure::connection_lost());
        }
        let remote = state.5.lock().await;
        let matches = if self.remote {
            remote.as_ref().is_some_and(|active| {
                Arc::ptr_eq(&active.gateway, &self.client)
                    && active.gateway.replay_epoch == self.scope.gateway_epoch
            })
        } else if remote.is_some() {
            false
        } else {
            state.0.lock().await.as_ref().is_some_and(|active| {
                Arc::ptr_eq(&active.gateway, &self.client)
                    && active.gateway.replay_epoch == self.scope.gateway_epoch
            })
        };
        if matches {
            Ok(())
        } else {
            Err(DesktopFailure::conflict())
        }
    }
}

/// The same URL builder is exercised by the locked Gateway receiver tests.
pub(crate) fn gateway_url(
    base: &str,
    kind: &str,
    path: &str,
    profile: &str,
    session: &str,
) -> Result<Url, DesktopFailure> {
    let mut url = Url::parse(base).map_err(|_| DesktopFailure::invalid_input())?;
    let scheme = match url.scheme() {
        "http" | "ws" => "http",
        "https" | "wss" => "https",
        _ => return Err(DesktopFailure::invalid_input()),
    };
    url.set_scheme(scheme)
        .map_err(|_| DesktopFailure::invalid_input())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(DesktopFailure::invalid_input());
    }
    url.set_query(None);
    url.set_fragment(None);
    let prefix = url
        .path()
        .trim_end_matches('/')
        .strip_suffix("/api/ws")
        .unwrap_or(url.path().trim_end_matches('/'))
        .to_owned();
    match kind {
        "session" => {
            url.set_path(&format!("{prefix}/api/sessions/"));
            url.path_segments_mut()
                .map_err(|_| DesktopFailure::invalid_input())?
                .pop_if_empty()
                .push(session);
        }
        "download" => url.set_path(&format!("{prefix}/api/fs/download")),
        _ => return Err(DesktopFailure::invalid_input()),
    }
    let mut query = url.query_pairs_mut();
    query.append_pair("profile", profile);
    if kind == "download" {
        query
            .append_pair("path", path)
            .append_pair("session_id", session);
    }
    drop(query);
    Ok(url)
}

pub(super) async fn resolve_owner(
    app: &AppHandle,
    state: &BackendState,
    scope: MediaScope,
) -> Result<(MediaOwner, HttpSource, String), DesktopFailure> {
    if scope.profile.is_empty()
        || scope.profile.len() > 64
        || scope.session_id.is_empty()
        || scope.session_id.len() > 256
        || scope.gateway_epoch.is_empty()
        || [&scope.profile, &scope.session_id, &scope.gateway_epoch]
            .iter()
            .any(|s| s.chars().any(char::is_control))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let remote_snapshot = state
        .5
        .lock()
        .await
        .as_ref()
        .map(|active| (Arc::clone(&active.gateway), active.config.clone()));
    let (owner, endpoint) = if let Some((client, config)) = remote_snapshot {
        if client.replay_epoch != scope.gateway_epoch {
            return Err(DesktopFailure::conflict());
        }
        let token = remote_config::token(config.id).await?;
        let endpoint = HttpSource {
            url: gateway_url(
                &config.url,
                "session",
                "",
                &scope.profile,
                &scope.session_id,
            )?,
            auth: Some(("Authorization", format!("Bearer {token}"))),
        };
        (
            MediaOwner {
                scope,
                client,
                remote: true,
                base_url: config.url,
            },
            endpoint,
        )
    } else {
        let resolved = state.resolve_profile(&scope.profile).await?;
        if resolved.gateway_epoch != scope.gateway_epoch {
            return Err(DesktopFailure::conflict());
        }
        let (port, header, token) = resolved.http_auth().await?;
        let client = state
            .0
            .lock()
            .await
            .as_ref()
            .map(|b| Arc::clone(&b.gateway))
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        let endpoint = HttpSource {
            url: gateway_url(
                &format!("http://127.0.0.1:{port}"),
                "session",
                "",
                &scope.profile,
                &scope.session_id,
            )?,
            auth: Some((header, token)),
        };
        (
            MediaOwner {
                scope,
                client,
                remote: false,
                base_url: format!("http://127.0.0.1:{port}"),
            },
            endpoint,
        )
    };
    owner.ensure_current(state).await?;
    let response = endpoint
        .request(Method::GET)?
        .send()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?;
    let bytes = read_response(response, 1024 * 1024).await?;
    let detail: Value =
        serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed())?;
    let cwd = detail
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    owner.ensure_current(state).await?;
    let _ = app; // Identity is read from BackendState, never the visible window's current profile.
    Ok((owner, endpoint, cwd))
}

pub(super) async fn read_response(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, DesktopFailure> {
    if !response.status().is_success()
        || response.content_length().is_some_and(|n| n > limit as u64)
    {
        return Err(DesktopFailure::operation_failed());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopFailure::connection_lost())?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(DesktopFailure::invalid_input());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(super) fn source_name(source: &str) -> String {
    let path = Url::parse(source)
        .ok()
        .filter(|u| matches!(u.scheme(), "http" | "https" | "file"))
        .map(|u| u.path().to_owned())
        .unwrap_or_else(|| source.to_owned());
    path.rsplit(['/', '\\'])
        .find(|s| !s.is_empty())
        .unwrap_or("media")
        .chars()
        .take(255)
        .collect()
}

pub(super) fn mime_for(name: &str) -> (&'static str, &'static str) {
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "bmp" => ("image", "image/bmp"),
        "svg" => ("image", "image/svg+xml"),
        "avif" => ("image", "image/avif"),
        "tif" | "tiff" => ("image", "image/tiff"),
        "mp3" | "m2a" => ("audio", "audio/mpeg"),
        "m4a" => ("audio", "audio/mp4"),
        "wav" => ("audio", "audio/wav"),
        "ogg" | "opus" => ("audio", "audio/ogg"),
        "flac" => ("audio", "audio/flac"),
        "mp4" => ("video", "video/mp4"),
        "webm" => ("video", "video/webm"),
        "mov" => ("video", "video/quicktime"),
        "avi" => ("video", "video/x-msvideo"),
        "mkv" => ("video", "video/x-matroska"),
        "3gp" => ("video", "video/3gpp"),
        "pdf" => ("file", "application/pdf"),
        "html" | "htm" => ("file", "text/html"),
        "txt" | "md" | "markdown" | "mdown" | "mkd" | "log" | "csv" | "tsv" | "json" | "yaml"
        | "yml" | "xml" | "rs" | "py" | "js" | "ts" | "css" => ("file", "text/plain"),
        _ => ("file", "application/octet-stream"),
    }
}

pub(super) fn sensitive(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    name == ".env"
        || name.starts_with(".env.")
        || name == ".envrc"
        || [
            "auth.json",
            "auth.lock",
            "credentials",
            "config.yaml",
            ".anthropic_oauth.json",
            "google_token.json",
            "google_oauth_pending.json",
            "google_oauth.json",
            "webhook_subscriptions.json",
            "bws_cache.json",
            "bws_cache.enc.json",
            ".git-credentials",
        ]
        .contains(&name.as_str())
        || path.components().any(|part| {
            ["mcp-tokens", "pairing", ".ssh", ".aws", ".gnupg"].contains(
                &part
                    .as_os_str()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .as_str(),
            )
        })
}

pub(super) fn local_path(source: &str, cwd: &str) -> Result<PathBuf, DesktopFailure> {
    if source.len() > 32768 || source.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let source = if source.to_ascii_lowercase().starts_with("file:") {
        Url::parse(source)
            .map_err(|_| DesktopFailure::invalid_input())?
            .to_file_path()
            .map_err(|_| DesktopFailure::invalid_input())?
    } else if source == "~" || source.starts_with("~/") || source.starts_with("~\\") {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .ok_or_else(DesktopFailure::invalid_input)?;
        PathBuf::from(home).join(source.get(2..).unwrap_or(""))
    } else {
        PathBuf::from(source)
    };
    let path = plain_path(&source);
    validate_local_path_type(&path)?;
    let path = if path.is_absolute() {
        path
    } else {
        let root = plain_path(Path::new(cwd));
        if !root.is_absolute() {
            return Err(DesktopFailure::invalid_input());
        }
        root.join(path)
    };
    if sensitive(&path) {
        return Err(DesktopFailure::invalid_input());
    }
    let canonical = path
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::invalid_input())?;
    if sensitive(&canonical) || !filesystem_path(&canonical).is_file() {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(canonical)
}

pub(super) fn validate_local_path_type(path: &Path) -> Result<(), DesktopFailure> {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if text.starts_with(r"\\.\") || text.starts_with(r"\\?\") || text.starts_with(r"\??\") {
            return Err(DesktopFailure::invalid_input());
        }
        let drive = text.as_bytes().get(1) == Some(&b':');
        if drive
            && (!text.as_bytes()[0].is_ascii_alphabetic() || text.as_bytes().get(2) != Some(&b'\\'))
        {
            return Err(DesktopFailure::invalid_input());
        }
        let rest = if drive { &text[2..] } else { text.as_ref() };
        if rest.contains(':') || rest.chars().any(|c| "<>\"|?*".contains(c)) {
            return Err(DesktopFailure::invalid_input());
        }
        for part in rest.split('\\') {
            let name = part
                .trim_end_matches([' ', '.'])
                .split('.')
                .next()
                .unwrap_or("")
                .to_ascii_uppercase();
            if ["CON", "PRN", "AUX", "NUL", "CLOCK$"].contains(&name.as_str())
                || ((name.starts_with("COM") || name.starts_with("LPT"))
                    && name.len() == 4
                    && matches!(name.as_bytes()[3], b'1'..=b'9'))
            {
                return Err(DesktopFailure::invalid_input());
            }
        }
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

pub(super) fn data_source(
    source: &str,
) -> Result<(MediaSource, String, &'static str), DesktopFailure> {
    let (header, encoded) = source
        .split_once(',')
        .ok_or_else(DesktopFailure::invalid_input)?;
    if !header.ends_with(";base64") || encoded.len() > (MAX_INLINE * 4 / 3 + 4) {
        return Err(DesktopFailure::invalid_input());
    }
    let mime = header
        .strip_prefix("data:")
        .and_then(|s| s.strip_suffix(";base64"))
        .ok_or_else(DesktopFailure::invalid_input)?
        .to_ascii_lowercase();
    let kind = if mime.starts_with("image/") {
        "image"
    } else if mime.starts_with("audio/") {
        "audio"
    } else if mime.starts_with("video/") {
        "video"
    } else {
        return Err(DesktopFailure::invalid_input());
    };
    if mime.len() > 80
        || !mime
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/+-._".contains(&b))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| DesktopFailure::invalid_input())?;
    if bytes.is_empty() || bytes.len() > MAX_INLINE {
        return Err(DesktopFailure::invalid_input());
    }
    Ok((MediaSource::Data(Arc::new(bytes)), mime, kind))
}

#[cfg(test)]
#[path = "tests/media_source.rs"]
mod tests;
