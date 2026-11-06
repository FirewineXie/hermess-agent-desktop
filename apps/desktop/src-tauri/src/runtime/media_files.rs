use super::{
    media::{MediaEntry, MediaPreview},
    media_source::{self, MediaSource, MAX_DOWNLOAD, MAX_HTML_PREVIEW, MAX_PREVIEW},
    BackendState,
};
use crate::{
    diagnostics::log_client_event,
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path, CanonicalizePlain},
};
use reqwest::Method;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

struct TemporaryFile {
    path: PathBuf,
    file: Option<tokio::fs::File>,
    resource_id: String,
}
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        // Close before removing: cancellation can drop this guard while a download is pending.
        drop(self.file.take());
        let result = std::fs::remove_file(filesystem_path(&self.path));
        let failed = result.is_err_and(|error| error.kind() != std::io::ErrorKind::NotFound);
        log_client_event(&format!(
            "{}chat_media_save_cleanup_{} resource={}",
            if failed { "ERROR " } else { "" },
            if failed { "failed" } else { "completed" },
            self.resource_id,
        ));
    }
}

pub(super) async fn preview(
    entry: &MediaEntry,
    state: &BackendState,
) -> Result<MediaPreview, DesktopFailure> {
    entry.ensure_current(state).await?;
    if entry.resource.kind != "file" || entry.resource.mime == "application/pdf" {
        return Ok(MediaPreview {
            kind: "unsupported",
            content: String::new(),
            truncated: false,
        });
    }
    let result = preview_source(&entry.source, &entry.resource.mime).await?;
    entry.ensure_current(state).await?;
    Ok(result)
}

async fn preview_source(source: &MediaSource, mime: &str) -> Result<MediaPreview, DesktopFailure> {
    let mut bytes = Vec::new();
    let limit = if mime == "text/html" {
        MAX_HTML_PREVIEW
    } else {
        MAX_PREVIEW
    };
    let cap = limit + 1;
    match source {
        MediaSource::Data(data) => bytes.extend_from_slice(&data[..data.len().min(cap)]),
        MediaSource::Local(path) => {
            let checked = media_source::local_path(&path.to_string_lossy(), "")?;
            let file = tokio::fs::File::open(filesystem_path(&checked))
                .await
                .map_err(|_| DesktopFailure::operation_failed())?;
            file.take(cap as u64)
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| DesktopFailure::operation_failed())?;
        }
        MediaSource::Http(source) => {
            let mut response = source
                .request(Method::GET)?
                .send()
                .await
                .map_err(|_| DesktopFailure::connection_lost())?;
            if !response.status().is_success() {
                return Err(DesktopFailure::operation_failed());
            }
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| DesktopFailure::connection_lost())?
            {
                let remaining = cap - bytes.len();
                bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                if bytes.len() == cap {
                    break;
                }
            }
        }
    }
    let truncated = bytes.len() > limit;
    if truncated {
        bytes.truncate(limit);
    }
    if bytes.contains(&0) {
        return Ok(MediaPreview {
            kind: "unsupported",
            content: String::new(),
            truncated: false,
        });
    }
    let content = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) if truncated && error.utf8_error().error_len().is_none() => {
            let valid = error.utf8_error().valid_up_to();
            String::from_utf8(error.into_bytes()[..valid].to_vec())
                .map_err(|_| DesktopFailure::operation_failed())?
        }
        Err(_) => {
            return Ok(MediaPreview {
                kind: "unsupported",
                content: String::new(),
                truncated: false,
            })
        }
    };
    // A truncated HTML document is text, never an executable partial widget.
    Ok(MediaPreview {
        kind: if mime == "text/html" && !truncated {
            "html"
        } else {
            "text"
        },
        content,
        truncated,
    })
}

fn target_path(destination: &str) -> Result<PathBuf, DesktopFailure> {
    if destination.len() > 32768 || destination.chars().any(char::is_control) {
        return Err(DesktopFailure::invalid_input());
    }
    let target = plain_path(Path::new(destination));
    media_source::validate_local_path_type(&target)?;
    if !target.is_absolute() || media_source::sensitive(&target) {
        return Err(DesktopFailure::invalid_input());
    }
    let parent = target
        .parent()
        .ok_or_else(DesktopFailure::invalid_input)?
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::invalid_input())?;
    let name = target
        .file_name()
        .ok_or_else(DesktopFailure::invalid_input)?;
    let result = parent.join(name);
    if media_source::sensitive(&result) {
        return Err(DesktopFailure::invalid_input());
    }
    if let Ok(metadata) = std::fs::symlink_metadata(filesystem_path(&result)) {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(DesktopFailure::invalid_input());
        }
    }
    Ok(result)
}

async fn write_chunk(
    entry: &MediaEntry,
    state: &BackendState,
    file: &mut tokio::fs::File,
    chunk: &[u8],
    count: &mut u64,
) -> Result<(), DesktopFailure> {
    entry.ensure_current(state).await?;
    *count = count.saturating_add(chunk.len() as u64);
    if *count > MAX_DOWNLOAD {
        return Err(DesktopFailure::invalid_input());
    }
    file.write_all(chunk)
        .await
        .map_err(|_| DesktopFailure::operation_failed())
}

pub(super) async fn save(
    entry: &MediaEntry,
    state: &BackendState,
    destination: &str,
) -> Result<(), DesktopFailure> {
    entry.ensure_current(state).await?;
    let target = target_path(destination)?;
    let temporary = target.with_file_name(format!(".hermess-media-{}.part", Uuid::new_v4()));
    let file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(filesystem_path(&temporary))
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut cleanup = TemporaryFile {
        path: temporary.clone(),
        file: Some(file),
        resource_id: entry.resource.id.clone(),
    };
    let file = cleanup
        .file
        .as_mut()
        .ok_or_else(DesktopFailure::operation_failed)?;
    let mut count = 0;
    let result = async {
        match &entry.source {
            MediaSource::Data(bytes) => write_chunk(entry, state, file, bytes, &mut count).await?,
            MediaSource::Local(path) => {
                let path = media_source::local_path(&path.to_string_lossy(), "")?;
                let mut source = tokio::fs::File::open(filesystem_path(&path))
                    .await
                    .map_err(|_| DesktopFailure::operation_failed())?;
                let mut buffer = vec![0; 128 * 1024];
                loop {
                    let size = source
                        .read(&mut buffer)
                        .await
                        .map_err(|_| DesktopFailure::operation_failed())?;
                    if size == 0 {
                        break;
                    }
                    write_chunk(entry, state, file, &buffer[..size], &mut count).await?;
                }
            }
            MediaSource::Http(source) => {
                let mut response = source
                    .request(Method::GET)?
                    .send()
                    .await
                    .map_err(|_| DesktopFailure::connection_lost())?;
                if !response.status().is_success()
                    || response.content_length().is_some_and(|n| n > MAX_DOWNLOAD)
                {
                    return Err(DesktopFailure::operation_failed());
                }
                while let Some(chunk) = response
                    .chunk()
                    .await
                    .map_err(|_| DesktopFailure::connection_lost())?
                {
                    write_chunk(entry, state, file, &chunk, &mut count).await?;
                }
            }
        }
        entry.ensure_current(state).await?;
        if entry
            .resource
            .size
            .is_some_and(|expected| expected != count)
        {
            return Err(DesktopFailure::conflict());
        }
        file.flush()
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        file.sync_all()
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        Ok(())
    }
    .await;
    drop(cleanup.file.take());
    result?;
    entry.ensure_current(state).await?;
    // The native save dialog has confirmed replacement. This is the commit point:
    // release/cancellation after it must never remove the user's completed download.
    replace_file(&temporary, &target)?;
    drop(cleanup);
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> Result<(), DesktopFailure> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let wide = |path: &Path| {
        filesystem_path(path)
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let result = unsafe {
        MoveFileExW(
            wide(source).as_ptr(),
            wide(target).as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(DesktopFailure::operation_failed())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> Result<(), DesktopFailure> {
    std::fs::rename(filesystem_path(source), filesystem_path(target))
        .map_err(|_| DesktopFailure::operation_failed())
}

#[cfg(test)]
#[path = "tests/media_files.rs"]
mod tests;
