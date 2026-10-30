use crate::diagnostics::append_client_event;
use crate::paths::CanonicalizePlain;
use std::{
    fs,
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

const MARKER_SUFFIX: &str = ".owner";
const MARKER_CONTENT: &str = "hermess-agent-desktop-retired-runtime-v1";
const REPARSE_POINT: u32 = 0x400;
static CLEANUP_RUNNING: AtomicBool = AtomicBool::new(false);

fn retired_name(name: &str) -> bool {
    let Some(suffix) = name.strip_prefix("payload.old-") else {
        return false;
    };
    let Some((timestamp, sequence)) = suffix.split_once('-') else {
        return false;
    };
    timestamp.len() == 14
        && timestamp.bytes().all(|value| value.is_ascii_digit())
        && !sequence.is_empty()
        && sequence.bytes().all(|value| value.is_ascii_digit())
}

fn removable_directory(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_dir() || metadata.file_attributes() & REPARSE_POINT != 0 {
        return false;
    }
    let marker = owner_marker(path);
    let Ok(metadata) = fs::symlink_metadata(&marker) else {
        return false;
    };
    if !metadata.is_file() || metadata.file_attributes() & REPARSE_POINT != 0 {
        return false;
    }
    fs::read_to_string(marker)
        .map(|value| value == MARKER_CONTENT)
        .unwrap_or(false)
}

fn owner_marker(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!("{name}{MARKER_SUFFIX}"))
}

fn orphaned_owner_marker(runtime: &Path, path: &Path, name: &str) -> bool {
    let Some(retired) = name.strip_suffix(MARKER_SUFFIX) else {
        return false;
    };
    if !retired_name(retired) {
        return false;
    }
    match fs::symlink_metadata(runtime.join(retired)) {
        Ok(_) => return false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return false,
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    metadata.is_file()
        && metadata.file_attributes() & REPARSE_POINT == 0
        && fs::read_to_string(path)
            .map(|value| value == MARKER_CONTENT)
            .unwrap_or(false)
}

fn cleanup(runtime: &Path) -> Result<usize, String> {
    let mut removed = 0;
    let mut failures = Vec::new();
    let entries = fs::read_dir(runtime).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if orphaned_owner_marker(runtime, &entry.path(), name) {
            if let Err(error) = fs::remove_file(entry.path()) {
                failures.push(format!("{name}: {error}"));
            }
            continue;
        }
        if !retired_name(name) || !removable_directory(&entry.path()) {
            continue;
        }
        match fs::remove_dir_all(entry.path()) {
            Ok(()) => {
                removed += 1;
                if let Err(error) = fs::remove_file(owner_marker(&entry.path())) {
                    failures.push(format!("{name}{MARKER_SUFFIX}: {error}"));
                }
            }
            Err(error) => failures.push(format!("{name}: {error}")),
        }
    }
    if failures.is_empty() {
        Ok(removed)
    } else {
        Err(failures.join("; "))
    }
}

fn cleanup_old_executable(resource: &Path) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable_parent = executable.parent().ok_or("无法定位程序目录")?;
    if executable_parent
        .canonicalize_plain()
        .map_err(|error| error.to_string())?
        != resource
            .canonicalize_plain()
            .map_err(|error| error.to_string())?
    {
        return Ok(());
    }
    let old = executable.with_extension("old.exe");
    if old.exists() {
        fs::remove_file(old).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(super) fn schedule_cleanup(resource: PathBuf, storage: PathBuf) {
    if CLEANUP_RUNNING.swap(true, Ordering::AcqRel) {
        return;
    }
    tokio::task::spawn_blocking(move || {
        let result = cleanup(&resource.join("runtime"));
        let executable_result = cleanup_old_executable(&resource);
        CLEANUP_RUNNING.store(false, Ordering::Release);
        match (result, executable_result) {
            (Ok(removed), Ok(())) if removed > 0 => {
                let _ = append_client_event(
                    &storage,
                    &format!("retired_runtime_removed count={removed}"),
                );
            }
            (Err(error), _) | (_, Err(error)) => {
                let _ = append_client_event(
                    &storage,
                    &format!("retired_runtime_cleanup_failed {error}"),
                );
            }
            _ => {}
        }
    });
}

#[cfg(test)]
#[path = "tests/retired_payload.rs"]
mod tests;
