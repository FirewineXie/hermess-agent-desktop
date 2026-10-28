use super::{remote_request_url, request_url_with_auth};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[test]
fn remote_config_url_keeps_gateway_prefix_and_explicit_profile() {
    let url = remote_request_url(
        "https://gateway.example/hermes",
        "/api/config/schema?include_defaults=false",
        "writer",
    )
    .unwrap();
    assert_eq!(
        url.as_str(),
        "https://gateway.example/hermes/api/config/schema?include_defaults=false&profile=writer"
    );
    let existing = remote_request_url(
        "https://gateway.example/hermes",
        "/api/config?profile=writer",
        "writer",
    )
    .unwrap();
    assert_eq!(
        existing.as_str(),
        "https://gateway.example/hermes/api/config?profile=writer"
    );
}

#[test]
fn remote_config_url_rejects_cross_profile_and_prefix_escape() {
    assert!(remote_request_url(
        "https://gateway.example",
        "/api/config?profile=other",
        "writer"
    )
    .is_err());
    assert!(
        remote_request_url("https://gateway.example/prefix", "/api/../admin", "writer").is_err()
    );
    assert!(remote_request_url(
        "https://gateway.example/prefix",
        "//attacker.example/api/config",
        "writer"
    )
    .is_err());
}

#[tokio::test]
async fn remote_config_http_uses_scoped_path_and_token_header() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let read = stream.read(&mut chunk).await.unwrap();
            assert!(read > 0);
            request.extend_from_slice(&chunk[..read]);
            if request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                break;
            }
        }
        let headers = String::from_utf8(request).unwrap();
        assert!(headers.starts_with("GET /prefix/api/config?profile=writer HTTP/1.1"));
        assert!(headers
            .to_ascii_lowercase()
            .contains("x-hermes-session-token: test-token"));
        let body = r#"{"config":{"model":{"provider":"example"}}}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        stream.write_all(response.as_bytes()).await.unwrap();
    });
    let url =
        remote_request_url(&format!("http://{address}/prefix"), "/api/config", "writer").unwrap();
    let result = request_url_with_auth(
        reqwest::Method::GET,
        url,
        None,
        "X-Hermes-Session-Token",
        "test-token".into(),
        Duration::from_secs(5),
        1024,
        false,
    )
    .await
    .unwrap();
    assert_eq!(
        result
            .pointer("/config/model/provider")
            .and_then(serde_json::Value::as_str),
        Some("example")
    );
    server.await.unwrap();
}
