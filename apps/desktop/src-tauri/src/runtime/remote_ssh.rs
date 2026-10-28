use crate::errors::DesktopFailure;
use crate::process_manager::{self, ProcessRegistration};
use serde::Serialize;
use std::time::Duration;
use tokio::{
    io::AsyncReadExt,
    net::TcpListener,
    process::{Child, Command},
    task::JoinHandle,
    time::timeout,
};

#[derive(Clone, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    pub host: String,
    pub user: String,
    pub port: u16,
    pub remote_port: u16,
    pub key_path: String,
}

pub struct SshTunnel {
    _child: Child,
    _registration: ProcessRegistration,
    stderr_drain: JoinHandle<()>,
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        let _ = self._child.start_kill();
        self.stderr_drain.abort();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProbe {
    pub status: &'static str,
    pub platform: Option<&'static str>,
}

fn valid_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 255 || host.starts_with('-') {
        return false;
    }
    let hostname = host
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    let ipv6 = host.bytes().filter(|byte| *byte == b':').count() >= 2
        && host.bytes().all(|byte| {
            byte.is_ascii_hexdigit() || matches!(byte, b':' | b'.' | b'%' | b'_' | b'-')
        });
    hostname || ipv6
}

fn valid_user(user: &str) -> bool {
    user.is_empty()
        || (user.len() <= 64
            && !user.starts_with('-')
            && user
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')))
}

fn ssh_args(
    host: &str,
    user: &str,
    port: u16,
    key_path: &str,
) -> Result<Vec<String>, DesktopFailure> {
    if !valid_host(host)
        || !valid_user(user)
        || port == 0
        || key_path.len() > 1024
        || key_path.starts_with('-')
        || key_path.chars().any(char::is_control)
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut args = vec![
        "-T".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "ConnectionAttempts=1".into(),
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
    ];
    if port != 22 {
        args.extend(["-p".into(), port.to_string()]);
    }
    if !key_path.is_empty() {
        args.extend(["-i".into(), key_path.into()]);
    }
    args.push("--".into());
    args.push(if user.is_empty() {
        host.into()
    } else {
        format!("{user}@{host}")
    });
    args.push("uname -s".into());
    Ok(args)
}

pub(super) fn target_label(target: &SshTarget) -> Result<String, DesktopFailure> {
    ssh_args(&target.host, &target.user, target.port, &target.key_path)?;
    if target.remote_port == 0 {
        return Err(DesktopFailure::invalid_input());
    }
    let host = if target.host.contains(':') {
        format!("[{}]", target.host)
    } else {
        target.host.clone()
    };
    let user = if target.user.is_empty() {
        String::new()
    } else {
        format!("{}@", target.user)
    };
    Ok(format!(
        "ssh://{user}{host}:{}/gateway/{}",
        target.port, target.remote_port
    ))
}

fn forward_args(target: &SshTarget, local_port: u16) -> Result<Vec<String>, DesktopFailure> {
    if local_port == 0 || target.remote_port == 0 {
        return Err(DesktopFailure::invalid_input());
    }
    let mut args = ssh_args(&target.host, &target.user, target.port, &target.key_path)?;
    args.pop();
    let destination = args.pop().ok_or_else(DesktopFailure::operation_failed)?;
    args.pop();
    args.extend([
        "-v".into(),
        "-N".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-L".into(),
        format!("127.0.0.1:{local_port}:127.0.0.1:{}", target.remote_port),
        "--".into(),
        destination,
    ]);
    Ok(args)
}

fn forward_ready(output: &[u8], port: u16) -> bool {
    let marker = format!("Local forwarding listening on 127.0.0.1 port {port}");
    output
        .windows(marker.len())
        .enumerate()
        .any(|(index, part)| {
            part == marker.as_bytes()
                && !output
                    .get(index + marker.len())
                    .is_some_and(u8::is_ascii_digit)
        })
}

pub(super) async fn start_tunnel(
    target: &SshTarget,
) -> Result<(String, SshTunnel), DesktopFailure> {
    target_label(target)?;
    let reserved = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| DesktopFailure::operation_failed())?;
    let port = reserved
        .local_addr()
        .map_err(|_| DesktopFailure::operation_failed())?
        .port();
    let args = forward_args(target, port)?;
    drop(reserved);
    let mut command = Command::new("ssh");
    command
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let (mut child, registration) = process_manager::spawn(&mut command, "ssh-tunnel")
        .map_err(|_| DesktopFailure::connection_lost())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(DesktopFailure::connection_lost)?;
    let ready = timeout(Duration::from_secs(15), async {
        let mut output = Vec::new();
        let mut chunk = [0u8; 2048];
        loop {
            let count = stderr
                .read(&mut chunk)
                .await
                .map_err(|_| DesktopFailure::connection_lost())?;
            if count == 0 {
                return Err(DesktopFailure::connection_lost());
            }
            output.extend_from_slice(&chunk[..count]);
            if forward_ready(&output, port) {
                return Ok(());
            }
            if output.len() > 16384 {
                output.drain(..output.len() - 8192);
            }
        }
    })
    .await;
    if !matches!(ready, Ok(Ok(())))
        || child
            .try_wait()
            .map_err(|_| DesktopFailure::connection_lost())?
            .is_some()
    {
        return Err(DesktopFailure::connection_lost());
    }
    let stderr_drain = tokio::spawn(async move {
        let mut chunk = [0u8; 2048];
        while stderr.read(&mut chunk).await.unwrap_or(0) > 0 {}
    });
    Ok((
        format!("http://127.0.0.1:{port}"),
        SshTunnel {
            _child: child,
            _registration: registration,
            stderr_drain,
        },
    ))
}

pub(super) async fn ensure_reachable(target: &SshTarget) -> Result<(), DesktopFailure> {
    let result = test_ssh_connection(
        target.host.clone(),
        target.user.clone(),
        target.port,
        target.key_path.clone(),
    )
    .await?;
    if result.status == "reachable" {
        Ok(())
    } else {
        Err(DesktopFailure::connection_lost())
    }
}

fn classify_failure(stderr: &str) -> &'static str {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("remote host identification has changed")
        || lower.contains("host key verification failed")
    {
        "host_key_changed"
    } else if lower.contains("permission denied") {
        "auth_failed"
    } else if lower.contains("could not resolve hostname")
        || lower.contains("connection refused")
        || lower.contains("no route to host")
        || lower.contains("connection timed out")
    {
        "unreachable"
    } else {
        "ssh_failed"
    }
}

#[tauri::command]
pub async fn test_ssh_connection(
    host: String,
    user: String,
    port: u16,
    key_path: String,
) -> Result<SshProbe, DesktopFailure> {
    let args = ssh_args(host.trim(), user.trim(), port, key_path.trim())?;
    let mut command = Command::new("ssh");
    command.args(&args).stdin(std::process::Stdio::null());
    let output = match timeout(
        Duration::from_secs(20),
        process_manager::output(&mut command, "ssh-probe"),
    )
    .await
    {
        Ok(Ok(output)) => output,
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SshProbe {
                status: "ssh_missing",
                platform: None,
            });
        }
        Ok(Err(_)) => return Err(DesktopFailure::operation_failed()),
        Err(_) => {
            return Ok(SshProbe {
                status: "timeout",
                platform: None,
            })
        }
    };
    if !output.status.success() {
        return Ok(SshProbe {
            status: classify_failure(&String::from_utf8_lossy(&output.stderr)),
            platform: None,
        });
    }
    let platform = match String::from_utf8_lossy(&output.stdout).trim() {
        "Linux" => Some("Linux"),
        "Darwin" => Some("Darwin"),
        _ => None,
    };
    Ok(SshProbe {
        status: if platform.is_some() {
            "reachable"
        } else {
            "unsupported_platform"
        },
        platform,
    })
}

#[cfg(test)]
#[path = "tests/remote_ssh.rs"]
mod tests;
