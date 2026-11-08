use super::coding_config;
use crate::{
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path},
    process_manager,
};
use serde::Serialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
    process::{Output, Stdio},
    time::Duration,
};
use tauri::AppHandle;
use tokio::{io::AsyncReadExt, process::Command};

#[derive(Serialize)]
pub(super) struct GitState {
    state: &'static str,
    branch: Option<String>,
    detached: bool,
    branches: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) switch_error: Option<&'static str>,
}

impl GitState {
    fn empty(state: &'static str) -> Self {
        Self {
            state,
            branch: None,
            detached: false,
            branches: vec![],
            switch_error: None,
        }
    }
}

// A subdirectory belongs to its nearest worktree, including linked-worktree .git files.
pub(super) fn repository(cwd: &Path) -> Option<PathBuf> {
    cwd.ancestors()
        .find(|directory| {
            let marker = filesystem_path(&directory.join(".git"));
            marker.is_file() || marker.is_dir()
        })
        .map(plain_path)
}

pub(super) fn hooks_directory(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    let path = coding_config::owned(app, Path::new("git-hooks-disabled"))?;
    fs::create_dir_all(filesystem_path(&path)).map_err(|_| DesktopFailure::operation_failed())?;
    Ok(path)
}

async fn git(cwd: &Path, hooks: &Path, args: &[&str]) -> io::Result<Output> {
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .args(["-c", "core.fsmonitor=false", "-c"])
        .arg(format!("core.hooksPath={}", plain_path(hooks).display()))
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // An inherited GIT_DIR or index override must never redirect a product operation to another repo.
    for (name, _) in std::env::vars_os().filter(|(name, _)| {
        name.to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
    }) {
        command.env_remove(name);
    }
    command.env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let (mut child, registration) = process_manager::spawn(&mut command, "coding_git")?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("Git stdout unavailable"))?
        .take(1024 * 1024 + 1);
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("Git stderr unavailable"))?
        .take(64 * 1024 + 1);
    let mut out = vec![];
    let mut err = vec![];
    let result = tokio::time::timeout(Duration::from_secs(15), async {
        let (status, _, _) = tokio::try_join!(
            child.wait(),
            stdout.read_to_end(&mut out),
            stderr.read_to_end(&mut err)
        )?;
        if out.len() > 1024 * 1024 || err.len() > 64 * 1024 {
            return Err(io::Error::other("Git output limit exceeded"));
        }
        Ok(Output {
            status,
            stdout: out,
            stderr: err,
        })
    })
    .await;
    let cleanup = registration.terminate_tree().await;
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    cleanup?;
    result.map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "Git operation timed out"))?
}

pub(super) async fn read(cwd: &Path, hooks: &Path) -> Result<GitState, DesktopFailure> {
    if repository(cwd).is_none() {
        return Ok(GitState::empty("not_repository"));
    }
    let refs = match git(
        cwd,
        hooks,
        &[
            "for-each-ref",
            "--format=%(refname:lstrip=2)",
            "--sort=refname",
            "refs/heads/",
        ],
    )
    .await
    {
        Ok(output) => output,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(GitState::empty("unavailable"))
        }
        Err(_) => return Err(DesktopFailure::operation_failed()),
    };
    if !refs.status.success() {
        return Err(DesktopFailure::operation_failed());
    }
    let branches = String::from_utf8(refs.stdout)
        .map_err(|_| DesktopFailure::operation_failed())?
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect();
    let head = git(cwd, hooks, &["symbolic-ref", "--quiet", "HEAD"])
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let (branch, detached) = if head.status.success() {
        (
            String::from_utf8(head.stdout)
                .map_err(|_| DesktopFailure::operation_failed())?
                .trim()
                .strip_prefix("refs/heads/")
                .ok_or_else(DesktopFailure::operation_failed)?
                .to_owned(),
            false,
        )
    } else if head.status.code() == Some(1) {
        let revision = git(cwd, hooks, &["rev-parse", "--short", "HEAD"])
            .await
            .map_err(|_| DesktopFailure::operation_failed())?;
        if !revision.status.success() {
            return Err(DesktopFailure::operation_failed());
        }
        (
            String::from_utf8(revision.stdout)
                .map_err(|_| DesktopFailure::operation_failed())?
                .trim()
                .to_owned(),
            true,
        )
    } else {
        return Err(DesktopFailure::operation_failed());
    };
    Ok(GitState {
        state: "repository",
        branch: Some(branch),
        detached,
        branches,
        switch_error: None,
    })
}

pub(super) async fn switch(
    cwd: &Path,
    hooks: &Path,
    target: &str,
) -> Result<GitState, DesktopFailure> {
    let current = read(cwd, hooks).await?;
    if current.state != "repository" || !current.branches.iter().any(|branch| branch == target) {
        return Err(DesktopFailure::invalid_input());
    }
    if current.branch.as_deref() == Some(target) && !current.detached {
        return Ok(current);
    }
    let output = git(cwd, hooks, &["switch", "--no-guess", "--", target])
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut next = read(cwd, hooks).await?;
    if !output.status.success() {
        next.switch_error = Some("rejected");
    }
    Ok(next)
}

#[cfg(test)]
#[path = "tests/coding_context.rs"]
mod tests;
