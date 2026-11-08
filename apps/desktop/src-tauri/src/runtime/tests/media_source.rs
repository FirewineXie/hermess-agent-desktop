use super::{data_source, gateway_url, local_path, mime_for, read_response, sensitive, MAX_INLINE};
use crate::paths::filesystem_path;
use serde_json::Value;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[test]
fn local_media_resolves_against_session_cwd_and_checks_file_kind() {
    let root = std::env::temp_dir().join(format!("hermess-media-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let image = root.join("二维码 with space.png");
    std::fs::write(&image, b"image").unwrap();
    let actual = local_path("二维码 with space.png", &root.to_string_lossy()).unwrap();
    assert_eq!(std::fs::read(filesystem_path(&actual)).unwrap(), b"image");
    assert!(local_path("二维码 with space.png", "").is_err());
    assert!(local_path(&root.to_string_lossy(), "").is_err());
    assert!(local_path("missing.png", &root.to_string_lossy()).is_err());
    let file_url = reqwest::Url::from_file_path(&image).unwrap();
    assert_eq!(local_path(file_url.as_str(), "").unwrap(), actual);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn private_credentials_and_non_media_data_are_rejected() {
    for name in [
        ".env",
        ".ENV.local",
        "auth.json",
        "mcp-tokens/server.json",
        ".ssh/id_ed25519",
    ] {
        assert!(sensitive(Path::new(name)), "{name}");
    }
    assert!(data_source("data:text/html;base64,PGgxPnRlc3Q8L2gxPg==").is_err());
    assert!(data_source("data:image/png;base64,invalid!").is_err());
    assert!(data_source(&format!(
        "data:image/png;base64,{}",
        "A".repeat(MAX_INLINE * 4 / 3 + 8)
    ))
    .is_err());
    assert!(data_source("data:image/png;base64,aW1hZ2U=").is_ok());
    assert_eq!(mime_for("录音.OPUS"), ("audio", "audio/ogg"));
    assert_eq!(
        mime_for("output.unknown"),
        ("file", "application/octet-stream")
    );
}

#[test]
fn gateway_queries_keep_owner_and_encode_paths_without_token() {
    let url = gateway_url(
        "wss://gateway.example/api/ws?token=discard",
        "download",
        r"C:\my images\二维码.png",
        "work",
        "session/one",
    )
    .unwrap();
    assert_eq!(url.scheme(), "https");
    assert_eq!(url.path(), "/api/fs/download");
    let query = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(query["profile"], "work");
    assert_eq!(query["session_id"], "session/one");
    assert_eq!(query["path"], r"C:\my images\二维码.png");
    assert!(!query.contains_key("token"));
    assert_eq!(
        gateway_url("http://127.0.0.1/hermes/", "download", "x", "default", "s")
            .unwrap()
            .path(),
        "/hermes/api/fs/download"
    );
    assert_eq!(
        gateway_url(
            "https://example.com/api/ws",
            "session",
            "",
            "default",
            "x/y"
        )
        .unwrap()
        .path(),
        "/api/sessions/x%2Fy"
    );
    assert!(gateway_url(
        "https://secret:password@example.com",
        "download",
        "p",
        "default",
        "s"
    )
    .is_err());
}

#[tokio::test]
async fn bounded_http_reader_rejects_oversized_and_redirect_responses() {
    for response in [
        "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n12345",
        "HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: http://example.com/\r\n\r\n",
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n123\r\n3\r\n456\r\n0\r\n\r\n",
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request).await;
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let response = client.get(format!("http://{addr}")).send().await.unwrap();
        assert!(read_response(response, 4).await.is_err());
        server.await.unwrap();
    }
}

#[tokio::test]
async fn public_media_follows_redirect_but_gateway_auth_never_does() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for position in 0..3 {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let count = stream.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..count]).to_lowercase();
            if position < 2 {
                assert!(!request.contains("authorization:"));
            } else {
                assert!(request.contains("authorization: bearer fixture"));
            }
            let response = if position == 1 {
                "HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\npng"
            } else {
                "HTTP/1.1 302 Found\r\nContent-Length: 0\r\nConnection: close\r\nLocation: /body\r\n\r\n"
            };
            stream.write_all(response.as_bytes()).await.unwrap();
        }
    });
    let url = reqwest::Url::parse(&format!("http://{addr}/redirect")).unwrap();
    let public = super::HttpSource {
        url: url.clone(),
        auth: None,
    };
    let response = public
        .request(reqwest::Method::GET)
        .unwrap()
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(read_response(response, 3).await.unwrap(), b"png");
    let gateway = super::HttpSource {
        url,
        auth: Some(("Authorization", "Bearer fixture".into())),
    };
    let response = gateway
        .request(reqwest::Method::GET)
        .unwrap()
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::FOUND);
    server.await.unwrap();
}

#[cfg(windows)]
#[test]
fn windows_media_paths_reject_devices_ads_and_drive_relative_paths() {
    for path in [
        r"\\.\pipe\secret",
        r"\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy1\a.png",
        r"C:relative.png",
        r"C:\a.png:secret",
        r"C:\CON.png",
        r"C:\temp\LPT1",
    ] {
        assert!(
            super::validate_local_path_type(Path::new(path)).is_err(),
            "{path}"
        );
    }
    assert!(super::validate_local_path_type(Path::new(r"C:\screenshots\二维码.png")).is_ok());
    assert!(super::validate_local_path_type(Path::new(r"\\server\share\image.png")).is_ok());
}

#[test]
#[ignore = "Receiver integration invokes this with isolated fixture paths"]
fn print_production_media_urls() {
    let cases: Vec<Value> =
        serde_json::from_str(&std::env::var("HERMESS_TEST_MEDIA_CASES").expect("media cases"))
            .unwrap();
    for case in cases {
        let field = |key| case[key].as_str().unwrap_or("");
        let url = gateway_url(
            field("base"),
            field("kind"),
            field("path"),
            field("profile"),
            field("session"),
        )
        .unwrap();
        println!(
            "PRODUCTION_MEDIA_URL={}",
            serde_json::json!({"name":field("name"),"url":url.as_str()})
        );
    }
}
