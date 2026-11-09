use crate::{gateway::GatewayClient, paths::filesystem_path};
use http_body_util::{combinators::UnsyncBoxBody, BodyExt, Full};
use hyper::{
    body::{Bytes, Incoming},
    header::{self, HeaderMap, HeaderValue},
    server::conn::http1,
    service::service_fn,
    upgrade::OnUpgrade,
    Method, Request, Response, StatusCode, Uri, Version,
};
use hyper_util::{
    client::legacy::{connect::HttpConnector, Client},
    rt::{TokioExecutor, TokioIo, TokioTimer},
};
use std::{convert::Infallible, path::Path, sync::Arc, time::Duration};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot},
    task::{JoinHandle, JoinSet},
    time::timeout,
};
use tokio_rustls::{
    rustls::{
        self,
        pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer},
    },
    TlsAcceptor,
};

type Body = UnsyncBoxBody<Bytes, hyper::Error>;

pub(crate) struct Listener {
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl Listener {
    pub(super) fn is_running(&self) -> bool {
        !self.task.is_finished()
    }

    pub(crate) async fn close(mut self) {
        self.shutdown.take();
        let _ = (&mut self.task).await;
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(super) fn tls(cert: &Path, key: &Path) -> Result<TlsAcceptor, &'static str> {
    let cert = std::fs::read(filesystem_path(cert)).map_err(|_| "certificate_read")?;
    let key = std::fs::read(filesystem_path(key)).map_err(|_| "private_key_read")?;
    let chain = CertificateDer::pem_slice_iter(&cert)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "certificate_pem")?;
    let key = PrivateKeyDer::from_pem_slice(&key).map_err(|_| "private_key_pem")?;
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_protocol_versions(&[&rustls::version::TLS13])
    .map_err(|_| "tls_version")?
    .with_no_client_auth()
    .with_single_cert(chain, key)
    .map_err(|_| "certificate_key")?;
    Ok(TlsAcceptor::from(Arc::new(config)))
}

#[derive(Clone)]
struct Target {
    client: Client<HttpConnector, Incoming>,
    public_origin: String,
    public_authority: String,
    local_authority: String,
    gateway: Arc<GatewayClient>,
}

pub(super) fn start(
    socket: TcpListener,
    tls: TlsAcceptor,
    public_origin: String,
    public_authority: String,
    port: u16,
    gateway: Arc<GatewayClient>,
    operation: uuid::Uuid,
) -> Listener {
    let mut connector = HttpConnector::new();
    connector.set_connect_timeout(Some(Duration::from_secs(3)));
    let target = Target {
        client: Client::builder(TokioExecutor::new())
            .pool_max_idle_per_host(0)
            .build(connector),
        public_origin,
        public_authority,
        local_authority: format!("127.0.0.1:{port}"),
        gateway,
    };
    let (shutdown, mut stop) = oneshot::channel();
    let task = tokio::spawn(async move {
        let mut connections = JoinSet::new();
        let mut health = tokio::time::interval(Duration::from_millis(500));
        let reason = loop {
            tokio::select! {
                biased;
                _ = &mut stop => break "disabled",
                _ = health.tick() => {
                    if target.gateway.is_closed() {
                        break "gateway_disconnected";
                    }
                }
                _ = connections.join_next(), if !connections.is_empty() => {}
                accepted = socket.accept(), if connections.len() < 128 => {
                    match accepted {
                        Ok((stream, _)) => {
                            JoinSet::spawn(&mut connections, serve(stream, tls.clone(), target.clone()));
                        }
                        Err(_) => break "accept_failed",
                    }
                }
            }
        };
        drop(socket);
        connections.shutdown().await;
        let level = if reason == "accept_failed" {
            "ERROR "
        } else {
            ""
        };
        crate::diagnostics::log_client_event(&format!(
            "{level}web_access_closed operation={operation} reason={reason}"
        ));
    });
    Listener {
        shutdown: Some(shutdown),
        task,
    }
}

struct Relay {
    browser: OnUpgrade,
    upstream: OnUpgrade,
}

async fn serve(stream: TcpStream, tls: TlsAcceptor, target: Target) {
    let Ok(Ok(stream)) = timeout(Duration::from_secs(8), tls.accept(stream)).await else {
        return;
    };
    let (sender, mut relay) = mpsc::channel::<Relay>(1);
    let service = service_fn(move |request| {
        let target = target.clone();
        let sender = sender.clone();
        async move { Ok::<_, Infallible>(forward(request, target, sender).await) }
    });
    let _ = http1::Builder::new()
        .timer(TokioTimer::new())
        .header_read_timeout(Duration::from_secs(10))
        .serve_connection(TokioIo::new(stream), service)
        .with_upgrades()
        .await;
    if let Some(relay) = relay.recv().await {
        if let Ok((browser, upstream)) = tokio::try_join!(relay.browser, relay.upstream) {
            let _ = tokio::io::copy_bidirectional(
                &mut TokioIo::new(browser),
                &mut TokioIo::new(upstream),
            )
            .await;
        }
    }
}

async fn forward(
    mut request: Request<Incoming>,
    target: Target,
    relay: mpsc::Sender<Relay>,
) -> Response<Body> {
    if target.gateway.is_closed() {
        return reply(StatusCode::SERVICE_UNAVAILABLE);
    }
    if !single_header(request.headers(), header::HOST)
        .is_some_and(|host| host.eq_ignore_ascii_case(&target.public_authority))
        || request.uri().authority().is_some()
        || request.method() == Method::CONNECT
    {
        return reply(StatusCode::BAD_REQUEST);
    }
    let path = request
        .uri()
        .path_and_query()
        .map_or("/", |part| part.as_str());
    if !path.starts_with('/') || path.starts_with("//") {
        return reply(StatusCode::BAD_REQUEST);
    }
    let uri = Uri::builder()
        .scheme("http")
        .authority(&*target.local_authority)
        .path_and_query(path)
        .build();
    let Ok(uri) = uri else {
        return reply(StatusCode::BAD_REQUEST);
    };
    let upgrade = request.headers().contains_key(header::UPGRADE);
    if upgrade
        && (request.version() != Version::HTTP_11
            || request.method() != Method::GET
            || !single_header(request.headers(), header::UPGRADE)
                .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
            || !connection_tokens(request.headers())
                .any(|part| part.eq_ignore_ascii_case("upgrade")))
    {
        return reply(StatusCode::BAD_REQUEST);
    }
    let has_origin = request.headers().contains_key(header::ORIGIN);
    if (upgrade || has_origin)
        && single_header(request.headers(), header::ORIGIN) != Some(&target.public_origin)
    {
        return reply(StatusCode::FORBIDDEN);
    }
    let browser = upgrade.then(|| hyper::upgrade::on(&mut request));
    *request.uri_mut() = uri;
    let headers = request.headers_mut();
    strip_hop_headers(headers);
    let external = headers
        .keys()
        .filter(|name| {
            matches!(name.as_str(), "forwarded" | "x-hermes-gateway-ticket")
                || name.as_str().starts_with("x-forwarded-")
        })
        .cloned()
        .collect::<Vec<_>>();
    for name in external {
        headers.remove(name);
    }
    headers.insert(
        header::HOST,
        HeaderValue::from_str(&target.local_authority).unwrap(),
    );
    if upgrade {
        headers.remove(header::ORIGIN);
        set_upgrade_headers(headers);
    } else if has_origin {
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_str(&format!("http://{}", target.local_authority)).unwrap(),
        );
    }
    let Ok(Ok(mut response)) =
        timeout(Duration::from_secs(120), target.client.request(request)).await
    else {
        return reply(StatusCode::BAD_GATEWAY);
    };
    let upgraded = response.status() == StatusCode::SWITCHING_PROTOCOLS;
    if upgraded {
        let Some(browser) = browser else {
            return reply(StatusCode::BAD_GATEWAY);
        };
        let upstream = hyper::upgrade::on(&mut response);
        if relay.try_send(Relay { browser, upstream }).is_err() {
            return reply(StatusCode::BAD_GATEWAY);
        }
    }
    let headers = response.headers_mut();
    strip_hop_headers(headers);
    if upgraded {
        set_upgrade_headers(headers);
    }
    response.map(BodyExt::boxed_unsync)
}

fn single_header(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
    let mut values = headers.get_all(name).iter();
    let first = values.next()?.to_str().ok()?;
    values.next().is_none().then_some(first)
}

fn connection_tokens(headers: &HeaderMap) -> impl Iterator<Item = &str> {
    headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(',').map(str::trim))
}

fn strip_hop_headers(headers: &mut HeaderMap) {
    let nominated = connection_tokens(headers)
        .filter_map(|token| header::HeaderName::from_bytes(token.as_bytes()).ok())
        .collect::<Vec<_>>();
    for name in nominated {
        headers.remove(name);
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "proxy-connection",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
}

fn set_upgrade_headers(headers: &mut HeaderMap) {
    headers.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
    headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
}

fn reply(status: StatusCode) -> Response<Body> {
    let mut response = Response::new(
        Full::new(Bytes::from_static(b"Web Access request refused"))
            .map_err(|error| match error {})
            .boxed_unsync(),
    );
    *response.status_mut() = status;
    response
}
