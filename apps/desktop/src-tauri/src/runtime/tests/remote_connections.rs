use super::{endpoint_url, normalized_remote_url, remote_websocket_url};
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};

#[test]
fn remote_url_preserves_prefix_but_drops_query_and_fragment() {
    let base = normalized_remote_url(" gateway.example:9119/prefix/?token=old#fragment ").unwrap();
    assert_eq!(base.as_str(), "http://gateway.example:9119/prefix");
    assert_eq!(
        endpoint_url(&base, "api/status").unwrap().as_str(),
        "http://gateway.example:9119/prefix/api/status"
    );
    assert_eq!(
        endpoint_url(&base, "api/ws").unwrap().as_str(),
        "http://gateway.example:9119/prefix/api/ws"
    );
    assert_eq!(
        remote_websocket_url(&base, "a/b c+d").unwrap().as_str(),
        "ws://gateway.example:9119/prefix/api/ws?token=a%2Fb+c%2Bd"
    );
    let secure = normalized_remote_url("https://gateway.example/prefix").unwrap();
    assert_eq!(
        remote_websocket_url(&secure, "token").unwrap().as_str(),
        "wss://gateway.example/prefix/api/ws?token=token"
    );
}

#[test]
fn remote_url_rejects_embedded_credentials_and_other_schemes() {
    assert!(normalized_remote_url("https://user:password@example.com").is_err());
    assert!(normalized_remote_url("file:///tmp/gateway").is_err());
    assert!(normalized_remote_url("https://example.com\nX-Forged: true").is_err());
}

#[tokio::test]
async fn remote_probe_requires_authenticated_http_and_websocket_pong() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        for _ in 0..3 {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut peeked = [0u8; 2048];
            let count = loop {
                let count = stream.peek(&mut peeked).await.unwrap();
                if peeked[..count].windows(4).any(|part| part == b"\r\n\r\n") {
                    break count;
                }
            };
            let request = String::from_utf8_lossy(&peeked[..count]);
            if request.starts_with("GET /api/ws?token=test-token ") {
                let mut socket = accept_async(stream).await.unwrap();
                let frame = socket.next().await.unwrap().unwrap();
                assert!(frame.to_text().unwrap().contains("\"method\":\"ping\""));
                socket
                    .send(Message::Text(
                        r#"{"jsonrpc":"2.0","id":1,"result":{"pong":true}}"#.into(),
                    ))
                    .await
                    .unwrap();
            } else {
                let mut consumed = vec![0u8; count];
                stream.read_exact(&mut consumed).await.unwrap();
                let status = if request.starts_with("GET /api/status ") {
                    200
                } else if request
                    .to_ascii_lowercase()
                    .contains("x-hermes-session-token: test-token")
                {
                    200
                } else {
                    401
                };
                let body = if request.starts_with("GET /api/status ") {
                    r#"{"version":"test","auth_required":false}"#
                } else {
                    r#"{"profiles":[]}"#
                };
                let response = format!("HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        }
    });
    let result = super::test_remote_url_connection(url, "test-token".into())
        .await
        .unwrap();
    assert_eq!(result.status, "ready");
    assert_eq!(result.profile_count, Some(0));
    server.await.unwrap();
}

#[tokio::test]
async fn remote_probe_rejects_wrong_token_before_websocket() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        for (path, status, body) in [
            ("/api/status", 200, r#"{"auth_required":false}"#),
            ("/api/profiles", 401, r#"{"detail":"Unauthorized"}"#),
        ] {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            let count = loop {
                let count = stream.peek(&mut request).await.unwrap();
                if request[..count].windows(4).any(|part| part == b"\r\n\r\n") {
                    break count;
                }
            };
            assert!(String::from_utf8_lossy(&request[..count]).starts_with(&format!("GET {path} ")));
            stream.read_exact(&mut request[..count]).await.unwrap();
            let response = format!("HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            stream.write_all(response.as_bytes()).await.unwrap();
        }
    });
    let result = super::test_remote_url_connection(url, "wrong-token".into())
        .await
        .unwrap();
    assert_eq!(result.status, "auth_rejected");
    server.await.unwrap();
}
