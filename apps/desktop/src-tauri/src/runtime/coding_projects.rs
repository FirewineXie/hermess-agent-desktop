use super::{coding::CodingSession, coding_config};
use crate::{errors::DesktopFailure, paths::filesystem_path};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
pub struct CodingProject {
    pub id: String,
    pub name: String,
    pub cwd: String,
    pub legacy_cwds: Vec<String>,
}
fn same_path(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.replace('/', "\\")
            .trim_end_matches('\\')
            .eq_ignore_ascii_case(right.replace('/', "\\").trim_end_matches('\\'))
    } else {
        left.trim_end_matches('/') == right.trim_end_matches('/')
    }
}
fn load(app: &AppHandle) -> Result<Vec<CodingProject>, DesktopFailure> {
    let path = coding_config::owned(app, Path::new("projects.json"))?;
    match fs::read(filesystem_path(&path)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| DesktopFailure::operation_failed()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(_) => Err(DesktopFailure::operation_failed()),
    }
}
fn write(app: &AppHandle, projects: &[CodingProject]) -> Result<(), DesktopFailure> {
    super::coding_vault::private_directory(&coding_config::root(app)?)?;
    let path = coding_config::owned(app, Path::new("projects.json"))?;
    coding_config::write_json(&path, &projects)
}
pub(super) fn list(app: &AppHandle) -> Result<Vec<CodingProject>, DesktopFailure> {
    let mut projects = load(app)?;
    let mut changed = false;
    let directory = coding_config::owned(app, Path::new("sessions"))?;
    if filesystem_path(&directory).is_dir() {
        for entry in fs::read_dir(filesystem_path(&directory))
            .map_err(|_| DesktopFailure::operation_failed())?
        {
            let entry = entry.map_err(|_| DesktopFailure::operation_failed())?;
            if entry
                .path()
                .extension()
                .is_none_or(|extension| extension != "json")
            {
                continue;
            }
            let id = entry
                .path()
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_owned();
            let path = super::coding::session_path(app, &id)?;
            let session: CodingSession = serde_json::from_slice(
                &fs::read(filesystem_path(&path))
                    .map_err(|_| DesktopFailure::operation_failed())?,
            )
            .map_err(|_| DesktopFailure::operation_failed())?;
            let exists = projects.iter().any(|project| match &session.project_id {
                Some(id) => project.id == *id,
                None => project
                    .legacy_cwds
                    .iter()
                    .any(|cwd| same_path(cwd, &session.cwd)),
            });
            if !exists {
                let name = Path::new(&session.cwd)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(&session.cwd)
                    .to_owned();
                projects.push(CodingProject {
                    id: session
                        .project_id
                        .unwrap_or_else(|| Uuid::new_v4().to_string()),
                    name,
                    cwd: session.cwd.clone(),
                    legacy_cwds: vec![session.cwd],
                });
                changed = true;
            }
        }
    }
    if changed {
        write(app, &projects)?;
        coding_config::log(app, "programming_projects_legacy_import_completed");
    }
    Ok(projects)
}
pub(super) fn save(
    app: &AppHandle,
    id: Option<String>,
    name: String,
    cwd: String,
) -> Result<CodingProject, DesktopFailure> {
    let operation = Uuid::new_v4();
    coding_config::log(
        app,
        &format!("programming_project_save_start operation={operation}"),
    );
    let result = (|| {
        let cwd = super::chat_create::validate_workspace_path(Some(cwd))?
            .ok_or_else(DesktopFailure::invalid_input)?;
        let name = name.trim().to_owned();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err(DesktopFailure::invalid_input());
        }
        if let Some(id) = &id {
            Uuid::parse_str(id).map_err(|_| DesktopFailure::invalid_input())?;
        }
        let mut projects = list(app)?;
        if projects
            .iter()
            .any(|project| Some(&project.id) != id.as_ref() && same_path(&project.cwd, &cwd))
        {
            return Err(DesktopFailure::conflict());
        }
        let project = if let Some(id) = id {
            let project = projects
                .iter_mut()
                .find(|project| project.id == id)
                .ok_or_else(DesktopFailure::invalid_input)?;
            project.name = name;
            project.cwd = cwd;
            project.clone()
        } else {
            let project = CodingProject {
                id: Uuid::new_v4().to_string(),
                name,
                cwd,
                legacy_cwds: vec![],
            };
            projects.push(project.clone());
            project
        };
        write(app, &projects)?;
        Ok(project)
    })();
    coding_config::log(
        app,
        &format!(
            "{}programming_project_save_result operation={operation} success={}",
            if result.is_err() { "ERROR " } else { "" },
            result.is_ok()
        ),
    );
    result
}
pub(super) fn directory(app: &AppHandle, id: &str) -> Result<String, DesktopFailure> {
    Uuid::parse_str(id).map_err(|_| DesktopFailure::invalid_input())?;
    load(app)?
        .into_iter()
        .find(|project| project.id == id)
        .map(|project| project.cwd)
        .ok_or_else(DesktopFailure::invalid_input)
}

#[cfg(all(test, windows))]
#[path = "tests/coding_projects.rs"]
mod tests;
