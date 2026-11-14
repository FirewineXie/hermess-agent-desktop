use super::{
    backend_running, channel_whatsapp::WhatsAppSetupState, gateway_control, location,
    restart_backend_gracefully_inner, BackendInfo, BackendState, GracefulRestartResult,
};
use crate::{
    diagnostics::log_client_event,
    errors::DesktopFailure,
    paths::{filesystem_path, plain_path},
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

mod certificate;
mod proxy;
pub(super) use proxy::Listener;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    origin: String,
    listen_ip: String,
    certificate_path: String,
    private_key_path: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            origin: "https://127.0.0.1:8443".into(),
            listen_ip: "127.0.0.1".into(),
            certificate_path: String::new(),
            private_key_path: String::new(),
        }
    }
}

impl Settings {
    fn validate_address(&mut self) -> Result<(SocketAddr, Url), DesktopFailure> {
        let url = Url::parse(self.origin.trim()).map_err(|_| failure("web_access_address"))?;
        if url.scheme() != "https"
            || url.host().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(failure("web_access_address"));
        }
        let port = url
            .port_or_known_default()
            .filter(|port| *port != 0)
            .ok_or_else(|| failure("web_access_address"))?;
        let ip: IpAddr = self
            .listen_ip
            .trim()
            .parse()
            .map_err(|_| failure("web_access_address"))?;
        self.listen_ip = ip.to_string();
        self.origin = url.origin().ascii_serialization();
        Ok((SocketAddr::new(ip, port), url))
    }

    fn normalize_pem_paths(&mut self) -> Result<(), DesktopFailure> {
        self.certificate_path = normalize_path(&self.certificate_path)?;
        self.private_key_path = normalize_path(&self.private_key_path)?;
        Ok(())
    }

    fn load_tls(&self) -> Result<tokio_rustls::TlsAcceptor, DesktopFailure> {
        proxy::tls(
            Path::new(&self.certificate_path),
            Path::new(&self.private_key_path),
        )
        .map_err(|reason| {
            log_client_event(&format!("ERROR web_access_tls_invalid reason={reason}"));
            failure("web_access_tls")
        })
    }
}

fn normalize_path(value: &str) -> Result<String, DesktopFailure> {
    let path = Path::new(value.trim());
    if !path.is_absolute() {
        return Err(failure("web_access_tls"));
    }
    Ok(plain_path(path).to_string_lossy().into_owned())
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Action {
    Status,
    Save { settings: Settings },
    Enable,
    Disable,
    Launch,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    settings: Settings,
    enabled: bool,
    link: Option<String>,
    restarted: Option<BackendInfo>,
}

fn failure(code: &'static str) -> DesktopFailure {
    DesktopFailure::web_access(code)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, DesktopFailure> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| failure("web_access_settings"))?
        .join("web-access.json"))
}

fn read_settings(path: &Path) -> Result<Settings, DesktopFailure> {
    match fs::read(filesystem_path(path)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| failure("web_access_settings")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(_) => Err(failure("web_access_settings")),
    }
}

#[tauri::command]
pub async fn web_access_request(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, BackendState>,
    whatsapp: State<'_, WhatsAppSetupState>,
    action: Action,
) -> Result<Status, DesktopFailure> {
    if window.label() != "main" {
        return Err(DesktopFailure::invalid_input());
    }
    request(app, &state, &whatsapp, action).await
}

async fn request(
    app: AppHandle,
    state: &State<'_, BackendState>,
    whatsapp: &State<'_, WhatsAppSetupState>,
    action: Action,
) -> Result<Status, DesktopFailure> {
    let path = config_path(&app)?;
    let mut cancellation = state.6.subscribe();
    let _lifecycle = state.6.gate.lock().await;
    if cancellation.has_changed().unwrap_or(true) {
        return Err(DesktopFailure::runtime_unavailable());
    }
    if matches!(action, Action::Disable) {
        disable(state).await;
    }
    let mut settings = read_settings(&path)?;
    let mut link = None;
    let mut restarted = None;
    let enabled = match action {
        Action::Status => is_enabled(state).await,
        Action::Save { settings: mut next } => {
            if is_enabled(state).await {
                return Err(DesktopFailure::conflict());
            }
            let (_, url) = next.validate_address()?;
            let generated = if next.certificate_path.trim().is_empty()
                && next.private_key_path.trim().is_empty()
            {
                let host = url
                    .host_str()
                    .ok_or_else(|| failure("web_access_address"))?;
                let directory = certificate::generate(
                    path.parent()
                        .ok_or_else(|| failure("web_access_settings"))?,
                    host.trim_matches(['[', ']']),
                )?;
                next.certificate_path = plain_path(&directory.path().join("cert.pem"))
                    .to_string_lossy()
                    .into_owned();
                next.private_key_path = plain_path(&directory.path().join("key.pem"))
                    .to_string_lossy()
                    .into_owned();
                Some(directory)
            } else {
                None
            };
            next.normalize_pem_paths()?;
            next.load_tls()?;
            let value = serde_json::to_value(&next).map_err(|_| failure("web_access_settings"))?;
            location::write_location_json(&path, &value)
                .map_err(|_| failure("web_access_settings"))?;
            if let Some(directory) = generated {
                drop(directory.keep());
                log_client_event("web_access_certificate_generated");
            }
            log_client_event("web_access_settings_saved");
            settings = next;
            false
        }
        Action::Enable => {
            let operation = Uuid::new_v4();
            log_client_event(&format!("web_access_enable_started operation={operation}"));
            let result = tokio::select! {
                biased;
                _ = cancellation.changed() => Err(DesktopFailure::runtime_unavailable()),
                result = enable(app, state, whatsapp, &mut settings, operation) => result,
            };
            match result {
                Ok(info) => {
                    restarted = info;
                    log_client_event(&format!("web_access_enabled operation={operation}"));
                }
                Err(error) => {
                    log_client_event(&format!(
                        "ERROR web_access_enable_failed operation={operation} error={error:?}"
                    ));
                    return Err(error);
                }
            }
            true
        }
        Action::Disable => false,
        Action::Launch => {
            link = Some(public_link(state, &settings.origin).await?);
            true
        }
    };
    Ok(Status {
        settings,
        enabled,
        link,
        restarted,
    })
}

async fn disable(state: &BackendState) {
    let listener = state
        .0
        .lock()
        .await
        .as_mut()
        .and_then(|backend| backend.web_access.take());
    if let Some(listener) = listener {
        listener.close().await;
    }
}

async fn public_link(state: &BackendState, origin: &str) -> Result<String, DesktopFailure> {
    let owned = state.0.lock().await;
    let backend = owned
        .as_ref()
        .filter(|backend| {
            backend
                .web_access
                .as_ref()
                .is_some_and(Listener::is_running)
        })
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    let local = launch_url(
        &backend.storage.join("hermes-home"),
        backend
            .child
            .id()
            .ok_or_else(DesktopFailure::runtime_unavailable)?,
        backend.port,
    )
    .await
    .map_err(|_| failure("web_access_link"))?;
    Ok(format!(
        "{origin}/webapp/launch#{}",
        local.fragment().unwrap_or_default()
    ))
}

async fn is_enabled(state: &BackendState) -> bool {
    state
        .0
        .lock()
        .await
        .as_ref()
        .and_then(|backend| backend.web_access.as_ref())
        .is_some_and(Listener::is_running)
}

async fn enable(
    app: AppHandle,
    state: &State<'_, BackendState>,
    whatsapp: &State<'_, WhatsAppSetupState>,
    settings: &mut Settings,
    operation: Uuid,
) -> Result<Option<BackendInfo>, DesktopFailure> {
    if is_enabled(state).await {
        return Ok(None);
    }
    if state.5.lock().await.is_some() {
        return Err(DesktopFailure::runtime_unavailable());
    }
    let (address, _) = settings.validate_address()?;
    settings.normalize_pem_paths()?;
    let authority = settings.origin.trim_start_matches("https://").to_owned();
    let tls = settings.load_tls()?;
    let socket = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|_| failure("web_access_bind"))?;
    let webapp = {
        let mut owned = state.0.lock().await;
        let backend = owned
            .as_mut()
            .ok_or_else(DesktopFailure::runtime_unavailable)?;
        if !backend_running(backend)? {
            return Err(DesktopFailure::runtime_unavailable());
        }
        backend
            .webapp
            .is_none()
            .then(|| ManagedWebapp::prepare(&backend.storage))
            .transpose()?
    };
    let restarted = if let Some(webapp) = webapp {
        match restart_backend_gracefully_inner(app, state, whatsapp, Some(webapp)).await? {
            GracefulRestartResult::Restarted { info } => Some(info),
            GracefulRestartResult::Deferred => return Err(failure("web_access_restart_deferred")),
        }
    } else {
        None
    };
    let mut owned = state.0.lock().await;
    let backend = owned
        .as_mut()
        .ok_or_else(DesktopFailure::runtime_unavailable)?;
    backend.web_access = Some(proxy::start(
        socket,
        tls,
        settings.origin.clone(),
        authority,
        backend.port,
        Arc::clone(&backend.gateway),
        operation,
    ));
    Ok(restarted)
}

pub(super) struct ManagedWebapp {
    directory: tempfile::TempDir,
    pub(super) port: u16,
}

impl ManagedWebapp {
    pub(super) fn prepare(storage: &Path) -> Result<Self, DesktopFailure> {
        // The locked Gateway merges this per-child overlay at startup. Preserve any
        // administrator policy by refusing to replace its managed scope.
        if std::env::var_os("HERMES_MANAGED_DIR").is_some_and(|path| !path.is_empty())
            || cfg!(unix) && Path::new("/etc/hermes").is_dir()
        {
            return Err(failure("web_access_managed_policy"));
        }
        let directory = tempfile::Builder::new()
            .prefix("web-access-")
            .tempdir_in(filesystem_path(&storage.join("control")))
            .map_err(|_| failure("web_access_settings"))?;
        let socket = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| failure("web_access_bind"))?;
        let port = socket
            .local_addr()
            .map_err(|_| failure("web_access_bind"))?
            .port();
        fs::write(
            directory.path().join("config.yaml"),
            format!(
                "webapp:\n  enabled: true\n  host: 127.0.0.1\n  port: {port}\n  public_url: ''\n"
            ),
        )
        .map_err(|_| failure("web_access_settings"))?;
        Ok(Self { directory, port })
    }

    pub(super) fn path(&self) -> PathBuf {
        plain_path(self.directory.path())
    }
}

async fn launch_url(home: &Path, pid: u32, port: u16) -> Result<Url, String> {
    let result = gateway_control::webapp_launch(home, pid).await?;
    let url = result
        .get("url")
        .and_then(serde_json::Value::as_str)
        .and_then(|url| Url::parse(url).ok())
        .ok_or("网关未返回 Webapp 启动地址")?;
    if url.origin().ascii_serialization() != format!("http://127.0.0.1:{port}")
        || url.path() != "/webapp/launch"
        || !url.fragment().is_some_and(|fragment| {
            fragment
                .strip_prefix("ticket=")
                .is_some_and(valid_credential)
        })
    {
        return Err("网关未返回有效的本机 Webapp 启动链接".into());
    }
    Ok(url)
}

fn valid_credential(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(super) async fn desktop_credential(
    home: &Path,
    pid: u32,
    port: u16,
) -> Result<String, DesktopFailure> {
    let launch = launch_url(home, pid, port)
        .await
        .map_err(|_| failure("web_access_link"))?;
    let ticket = launch
        .fragment()
        .and_then(|fragment| fragment.strip_prefix("ticket="))
        .ok_or_else(|| failure("web_access_link"))?;
    let origin = format!("http://127.0.0.1:{port}");
    let response = super::local_http::client()?
        .post(format!("{origin}/webapp/window-session"))
        .timeout(Duration::from_secs(5))
        .header("Origin", &origin)
        .header("X-Hermes-Window-Ticket", ticket)
        .send()
        .await
        .map_err(|_| failure("web_access_link"))?
        .error_for_status()
        .map_err(|_| failure("web_access_link"))?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| failure("web_access_link"))?;
    body.get("token")
        .and_then(serde_json::Value::as_str)
        .filter(|token| valid_credential(token))
        .map(str::to_owned)
        .ok_or_else(|| failure("web_access_link"))
}

#[cfg(all(test, windows))]
#[path = "tests/web_access.rs"]
mod tests;
