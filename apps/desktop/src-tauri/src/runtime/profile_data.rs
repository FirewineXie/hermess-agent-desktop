use super::BackendState;
use crate::errors::DesktopFailure;
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path},
    process::Command,
};
use tauri::State;

#[derive(Serialize)]
pub struct ProfileDataDirectory {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDataListing {
    path: String,
    relative_path: String,
    parent: Option<String>,
    entries: Vec<ProfileDataEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDataEntry {
    name: String,
    relative_path: String,
    directory: bool,
    link: bool,
}

fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(local) = value.strip_prefix(r"\\?\") {
            return local.to_owned();
        }
    }
    value.into_owned()
}

fn checked_directory(home: &Path, storage: &Path, profile: &str) -> Result<String, DesktopFailure> {
    let root = storage
        .join("hermes-home")
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let directory = home
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let expected = if profile == "default" {
        root
    } else {
        root.join("profiles").join(profile)
    };
    if directory != expected || !directory.is_dir() {
        return Err(DesktopFailure::invalid_input());
    }
    Ok(display_path(home))
}

fn list_directory(
    home: &Path,
    storage: &Path,
    profile: &str,
    relative_path: &str,
) -> Result<ProfileDataListing, DesktopFailure> {
    checked_directory(home, storage, profile)?;
    let relative = Path::new(relative_path);
    if !relative
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut checked = home.to_path_buf();
    for component in relative.components() {
        checked.push(component.as_os_str());
        if fs::symlink_metadata(&checked)
            .map_err(|_| DesktopFailure::operation_failed())?
            .file_type()
            .is_symlink()
        {
            return Err(DesktopFailure::invalid_input());
        }
    }
    let directory = checked
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let root = home
        .canonicalize()
        .map_err(|_| DesktopFailure::operation_failed())?;
    if !directory.starts_with(root) || !directory.is_dir() {
        return Err(DesktopFailure::invalid_input());
    }
    let mut entries = fs::read_dir(&directory)
        .map_err(|_| DesktopFailure::operation_failed())?
        .map(|entry| {
            let entry = entry.map_err(|_| DesktopFailure::operation_failed())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let kind = entry
                .file_type()
                .map_err(|_| DesktopFailure::operation_failed())?;
            let next = if relative_path.is_empty() {
                name.clone()
            } else {
                format!("{relative_path}/{name}")
            };
            Ok(ProfileDataEntry {
                name,
                relative_path: next,
                directory: kind.is_dir(),
                link: kind.is_symlink(),
            })
        })
        .collect::<Result<Vec<_>, DesktopFailure>>()?;
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    let parent = relative_path
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_owned())
        .or_else(|| (!relative_path.is_empty()).then(String::new));
    Ok(ProfileDataListing {
        path: display_path(&checked),
        relative_path: relative_path.to_owned(),
        parent,
        entries,
    })
}

#[tauri::command]
pub async fn get_profile_data_directory(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<ProfileDataDirectory, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    scope.ensure_current(&state).await?;
    Ok(ProfileDataDirectory {
        path: checked_directory(&scope.home, &scope.storage, &scope.profile)?,
    })
}

#[tauri::command]
pub async fn list_profile_data_directory(
    state: State<'_, BackendState>,
    profile: String,
    relative_path: Option<String>,
) -> Result<ProfileDataListing, DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    scope.ensure_current(&state).await?;
    list_directory(
        &scope.home,
        &scope.storage,
        &scope.profile,
        relative_path.as_deref().unwrap_or(""),
    )
}

#[tauri::command]
pub async fn open_profile_data_directory(
    state: State<'_, BackendState>,
    profile: String,
) -> Result<(), DesktopFailure> {
    let scope = state.resolve_profile(&profile).await?;
    scope.ensure_current(&state).await?;
    let directory = checked_directory(&scope.home, &scope.storage, &scope.profile)?;
    #[cfg(target_os = "windows")]
    let program = "explorer.exe";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let program = "xdg-open";
    Command::new(program)
        .arg(directory)
        .spawn()
        .map_err(|_| DesktopFailure::operation_failed())?;
    Ok(())
}

#[cfg(test)]
#[path = "tests/profile_data.rs"]
mod tests;
