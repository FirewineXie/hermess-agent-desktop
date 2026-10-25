//! Read public GitHub releases and download an installer without installing it.

use crate::errors::DesktopFailure;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const REPO: &str = "FirewineXie/hermess-agent-desktop";
const RELEASES_URL: &str =
    "https://api.github.com/repos/FirewineXie/hermess-agent-desktop/releases";
const MAX_ASSET_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    id: u64,
    name: String,
    size: u64,
    digest: Option<String>,
    browser_download_url: String,
    state: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAsset {
    id: u64,
    name: String,
    size: u64,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRelease {
    tag_name: String,
    version: String,
    channel: &'static str,
    eligible: bool,
    asset: Option<UpdateAsset>,
}

#[derive(Serialize)]
pub struct UpdateLookup {
    status: &'static str,
    releases: Vec<UpdateRelease>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    tag_name: String,
    downloaded: u64,
    total: u64,
}

fn client() -> Result<Client, DesktopFailure> {
    Client::builder()
        .user_agent("Hermess-Agent-Desktop")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .map_err(|_| DesktopFailure::operation_failed())
}

fn release_channel(tag: &str) -> Option<(&str, &'static str)> {
    let version = tag.strip_prefix('v').unwrap_or(tag);
    let (base, channel) = match version.split_once("-rc.") {
        Some((base, rc)) if !rc.is_empty() && rc.bytes().all(|byte| byte.is_ascii_digit()) => {
            (base, "rc")
        }
        Some(_) => return None,
        None => (version, "stable"),
    };
    let parts: Vec<_> = base.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return None;
    }
    Some((version, channel))
}

fn asset_prefix() -> Option<(&'static str, &'static str)> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some(("win32-x64-", ".exe")),
        ("macos", "aarch64") => Some(("darwin-arm64-", ".dmg")),
        ("macos", "x86_64") => Some(("darwin-x64-", ".dmg")),
        _ => None,
    }
}

fn valid_digest(value: &str) -> Option<&str> {
    let hex = value.strip_prefix("sha256:")?;
    (hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(hex)
}

fn safe_asset(asset: &GithubAsset, tag: &str) -> Option<UpdateAsset> {
    let (prefix, extension) = asset_prefix()?;
    let version = tag.strip_prefix('v').unwrap_or(tag);
    let name = &asset.name;
    let digest = valid_digest(asset.digest.as_deref()?)?;
    if asset.state != "uploaded"
        || asset.size <= 1024 * 1024
        || asset.size > MAX_ASSET_BYTES
        || !name.starts_with(prefix)
        || !name.ends_with(extension)
        || !name.contains(version)
        || name.contains("..")
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-_".contains(&byte))
    {
        return None;
    }
    Some(UpdateAsset {
        id: asset.id,
        name: name.clone(),
        size: asset.size,
        sha256: digest.to_ascii_lowercase(),
    })
}

fn matching_asset(release: &GithubRelease) -> Option<UpdateAsset> {
    let matches: Vec<_> = release
        .assets
        .iter()
        .filter_map(|asset| safe_asset(asset, &release.tag_name))
        .collect();
    (matches.len() == 1)
        .then(|| matches.into_iter().next())
        .flatten()
}

fn to_candidate(release: GithubRelease) -> Option<UpdateRelease> {
    if release.draft {
        return None;
    }
    let (version, channel) = release_channel(&release.tag_name)?;
    let version = version.to_owned();
    let eligible = (channel == "rc") == release.prerelease;
    let asset = matching_asset(&release);
    Some(UpdateRelease {
        tag_name: release.tag_name,
        version,
        channel,
        eligible: eligible && asset.is_some(),
        asset,
    })
}

#[tauri::command]
pub async fn check_updates() -> Result<UpdateLookup, DesktopFailure> {
    let response = client()?
        .get(format!("{RELEASES_URL}?per_page=100"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if matches!(
        response.status(),
        StatusCode::NOT_FOUND | StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        return Ok(UpdateLookup {
            status: "unavailable",
            releases: Vec::new(),
        });
    }
    if !response.status().is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    let releases: Vec<GithubRelease> = response
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    Ok(UpdateLookup {
        status: "available",
        releases: releases.into_iter().filter_map(to_candidate).collect(),
    })
}

fn trusted_download_url(asset: &GithubAsset, tag: &str) -> bool {
    let Ok(url) = Url::parse(&asset.browser_download_url) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.query().is_none()
        && url.path() == format!("/{REPO}/releases/download/{tag}/{}", asset.name)
}

async fn sha256_file(path: &Path) -> Result<String, DesktopFailure> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn stream_installer(
    app: &AppHandle,
    client: &Client,
    tag: &str,
    asset: &GithubAsset,
    temp: &Path,
    expected_sha256: &str,
) -> Result<(), DesktopFailure> {
    let mut response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !response.status().is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let mut last_reported = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or_else(DesktopFailure::operation_failed)?;
        if downloaded > asset.size {
            return Err(DesktopFailure::operation_failed());
        }
        file.write_all(&chunk)
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        hasher.update(&chunk);
        if downloaded - last_reported >= 1024 * 1024 {
            let _ = app.emit(
                "update-download-progress",
                DownloadProgress {
                    tag_name: tag.to_owned(),
                    downloaded,
                    total: asset.size,
                },
            );
            last_reported = downloaded;
        }
    }
    file.flush()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if downloaded != asset.size || format!("{:x}", hasher.finalize()) != expected_sha256 {
        return Err(DesktopFailure::operation_failed());
    }
    let _ = app.emit(
        "update-download-progress",
        DownloadProgress {
            tag_name: tag.to_owned(),
            downloaded,
            total: asset.size,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    tag_name: String,
    asset_id: u64,
) -> Result<String, DesktopFailure> {
    if release_channel(&tag_name).is_none() {
        return Err(DesktopFailure::invalid_input());
    }
    let client = client()?;
    let response = client
        .get(format!("{RELEASES_URL}/tags/{tag_name}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !response.status().is_success() {
        return Err(DesktopFailure::operation_failed());
    }
    let release: GithubRelease = response
        .json()
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    if release.draft
        || release.tag_name != tag_name
        || release_channel(&tag_name)
            .is_none_or(|(_, channel)| (channel == "rc") != release.prerelease)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let selected = matching_asset(&release).ok_or_else(DesktopFailure::invalid_input)?;
    if selected.id != asset_id {
        return Err(DesktopFailure::invalid_input());
    }
    let asset = release
        .assets
        .iter()
        .find(|item| item.id == asset_id)
        .ok_or_else(DesktopFailure::invalid_input)?;
    if !trusted_download_url(asset, &tag_name) {
        return Err(DesktopFailure::invalid_input());
    }

    let downloads = app
        .path()
        .download_dir()
        .map_err(|_| DesktopFailure::operation_failed())?;
    tokio::fs::create_dir_all(&downloads)
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let destination = downloads.join(&selected.name);
    if tokio::fs::try_exists(&destination)
        .await
        .map_err(|_| DesktopFailure::operation_failed())?
    {
        if sha256_file(&destination).await? == selected.sha256 {
            return Ok(destination.to_string_lossy().into_owned());
        }
        return Err(DesktopFailure::conflict());
    }
    let temp = downloads.join(format!(".{}.{}.part", selected.name, uuid::Uuid::new_v4()));
    if let Err(error) =
        stream_installer(&app, &client, &tag_name, asset, &temp, &selected.sha256).await
    {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(error);
    }
    if tokio::fs::hard_link(&temp, &destination).await.is_err() {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(DesktopFailure::conflict());
    }
    let _ = tokio::fs::remove_file(&temp).await;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
#[path = "tests/updates.rs"]
mod tests;
