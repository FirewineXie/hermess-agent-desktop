use super::{
    media::{MediaEntry, MediaResources},
    media_source::{self, MediaSource, MAX_CHUNK, MAX_INLINE},
    BackendState,
};
use crate::{diagnostics::log_client_event, errors::DesktopFailure, paths::filesystem_path};
use reqwest::Method;
use std::sync::Arc;
use tauri::{
    http::{Request, Response, StatusCode},
    AppHandle, Manager,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

#[derive(Debug, PartialEq)]
pub(super) struct ByteRange {
    pub start: u64,
    pub end: u64,
}

pub(super) fn parse_range(value: &str, size: u64) -> Result<ByteRange, ()> {
    if size == 0 {
        return Err(());
    }
    let (start, end) = value
        .strip_prefix("bytes=")
        .ok_or(())?
        .split_once('-')
        .ok_or(())?;
    if end.contains(',') || start.contains(',') {
        return Err(());
    }
    let (start, end) = if start.is_empty() {
        let length = end.parse::<u64>().map_err(|_| ())?;
        if length == 0 {
            return Err(());
        }
        (size.saturating_sub(length), size - 1)
    } else {
        let start = start.parse::<u64>().map_err(|_| ())?;
        let end = if end.is_empty() {
            size - 1
        } else {
            end.parse::<u64>().map_err(|_| ())?.min(size - 1)
        };
        (start, end)
    };
    if start >= size || end < start {
        return Err(());
    }
    Ok(ByteRange {
        start,
        end: end.min(start.saturating_add(MAX_CHUNK - 1)),
    })
}

pub(super) fn response_error(status: StatusCode, size: Option<u64>) -> Response<Vec<u8>> {
    let mut response = Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store")
        .header("Content-Type", "text/plain; charset=utf-8");
    if status == StatusCode::RANGE_NOT_SATISFIABLE {
        if let Some(size) = size {
            response = response.header("Content-Range", format!("bytes */{size}"));
        }
    }
    response
        .body(format!("Media request failed ({})", status.as_u16()).into_bytes())
        .unwrap_or_default()
}

async fn load(
    entry: &MediaEntry,
    state: &BackendState,
    range: Option<&ByteRange>,
) -> Result<Vec<u8>, DesktopFailure> {
    entry.ensure_current(state).await?;
    let bytes = read_source(&entry.source, entry.resource.size, range).await?;
    entry.ensure_current(state).await?;
    Ok(bytes)
}

async fn read_source(
    source: &MediaSource,
    expected_size: Option<u64>,
    range: Option<&ByteRange>,
) -> Result<Vec<u8>, DesktopFailure> {
    let limit = range.map_or(MAX_INLINE, |r| (r.end - r.start + 1) as usize);
    let bytes = match source {
        MediaSource::Data(bytes) => {
            let start = range.map_or(0, |r| r.start as usize);
            bytes
                .get(start..start.saturating_add(limit).min(bytes.len()))
                .ok_or_else(DesktopFailure::invalid_input)?
                .to_vec()
        }
        MediaSource::Local(path) => {
            let path = media_source::local_path(&path.to_string_lossy(), "")?;
            let mut file = tokio::fs::File::open(filesystem_path(&path))
                .await
                .map_err(|_| DesktopFailure::operation_failed())?;
            let size = file
                .metadata()
                .await
                .map_err(|_| DesktopFailure::operation_failed())?
                .len();
            if expected_size.is_some_and(|expected| expected != size) {
                return Err(DesktopFailure::conflict());
            }
            if range.is_none() && size > limit as u64 {
                return Err(DesktopFailure::invalid_input());
            }
            if let Some(range) = range {
                file.seek(std::io::SeekFrom::Start(range.start))
                    .await
                    .map_err(|_| DesktopFailure::operation_failed())?;
            }
            let mut bytes = Vec::new();
            file.take(limit as u64)
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| DesktopFailure::operation_failed())?;
            bytes
        }
        MediaSource::Http(source) => {
            let mut request = source.request(Method::GET)?;
            if let Some(range) = range {
                request = request.header("Range", format!("bytes={}-{}", range.start, range.end));
            }
            let response = request
                .send()
                .await
                .map_err(|_| DesktopFailure::connection_lost())?;
            if let Some(range) = range {
                let expected = format!("bytes {}-{}/", range.start, range.end);
                let content_range = response
                    .headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok());
                if response.status() != reqwest::StatusCode::PARTIAL_CONTENT
                    || !content_range.is_some_and(|v| v.starts_with(&expected))
                    || expected_size.is_some_and(|size| {
                        content_range
                            .and_then(|v| v.rsplit('/').next())
                            .and_then(|v| v.parse::<u64>().ok())
                            != Some(size)
                    })
                {
                    // A sandbox/HTTP server that ignores Range cannot safely provide a seekable resource.
                    return Err(DesktopFailure::operation_failed());
                }
            }
            media_source::read_response(response, limit).await?
        }
    };
    if range.is_some_and(|r| bytes.len() as u64 != r.end - r.start + 1) {
        return Err(DesktopFailure::operation_failed());
    }
    if range.is_none() && expected_size.is_some_and(|size| size != bytes.len() as u64) {
        return Err(DesktopFailure::conflict());
    }
    Ok(bytes)
}

async fn entry_response(
    entry: Arc<MediaEntry>,
    state: &BackendState,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if entry.ensure_current(state).await.is_err() {
        return response_error(StatusCode::GONE, None);
    }
    let size = entry.resource.size;
    let range = if let Some(header) = request.headers().get("Range") {
        let parsed =
            size.and_then(|size| header.to_str().ok().and_then(|v| parse_range(v, size).ok()));
        match parsed {
            Some(range) => Some(range),
            None => return response_error(StatusCode::RANGE_NOT_SATISFIABLE, size),
        }
    } else {
        None
    };
    let head = request.method() == "HEAD";
    if !head && range.is_none() && size.is_some_and(|n| n > MAX_INLINE as u64) {
        return response_error(StatusCode::PAYLOAD_TOO_LARGE, size);
    }
    let bytes = if head {
        Vec::new()
    } else {
        match load(&entry, state, range.as_ref()).await {
            Ok(bytes) => bytes,
            Err(_) => {
                log_client_event(&format!(
                    "ERROR chat_media_read_failed resource={}",
                    entry.resource.id
                ));
                return response_error(StatusCode::BAD_GATEWAY, None);
            }
        }
    };
    if entry.ensure_current(state).await.is_err() {
        return response_error(StatusCode::GONE, None);
    }
    let mut response = Response::builder()
        .status(if range.is_some() {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header("Content-Type", &entry.resource.mime)
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Length,Content-Range,Accept-Ranges",
        )
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'");
    if entry.resource.kind == "file" && entry.resource.mime != "application/pdf" {
        response = response.header("Content-Disposition", "attachment");
    }
    if let Some(range) = range {
        response = response
            .header(
                "Content-Range",
                format!("bytes {}-{}/{}", range.start, range.end, size.unwrap_or(0)),
            )
            .header("Content-Length", range.end - range.start + 1);
    } else if let Some(size) = size {
        response = response.header("Content-Length", size);
    }
    response
        .body(bytes)
        .unwrap_or_else(|_| response_error(StatusCode::INTERNAL_SERVER_ERROR, None))
}

pub(super) async fn respond(
    app: &AppHandle,
    label: &str,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method() != "GET" && request.method() != "HEAD" {
        return response_error(StatusCode::METHOD_NOT_ALLOWED, None);
    }
    let id = request.uri().path().trim_start_matches('/');
    if uuid::Uuid::parse_str(id).is_err() {
        return response_error(StatusCode::NOT_FOUND, None);
    }
    let resources = app.state::<MediaResources>();
    let Ok(entry) = resources.get(id, label) else {
        return response_error(StatusCode::NOT_FOUND, None);
    };
    let state = app.state::<BackendState>();
    tokio::select! {
        response = entry_response(Arc::clone(&entry), &state, request) => response,
        _ = entry.cancelled() => response_error(StatusCode::GONE, None),
    }
}

#[cfg(test)]
#[path = "tests/media_protocol.rs"]
mod tests;
