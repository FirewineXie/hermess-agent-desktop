use super::{completed, validate, ValidationStage};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

pub(crate) fn fixture(status: u16, mode: &'static str) -> (String, thread::JoinHandle<()>) {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/v1", server.local_addr().unwrap());
    let handle = thread::spawn(move || {
        let count = if status == 200 && mode != "missing" {
            2
        } else {
            1
        };
        for turn in 0..count {
            let (mut socket, _) = server.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let (offset, length) = loop {
                let mut chunk = [0; 4096];
                let size = socket.read(&mut chunk).unwrap();
                assert!(size > 0);
                bytes.extend_from_slice(&chunk[..size]);
                if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    assert!(header.starts_with("post /v1/responses "));
                    assert!(header.contains("authorization: bearer fixture-key"));
                    let length = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse::<usize>()
                        .unwrap();
                    break (end + 4, length);
                }
            };
            while bytes.len() < offset + length {
                let mut chunk = [0; 4096];
                let size = socket.read(&mut chunk).unwrap();
                assert!(size > 0);
                bytes.extend_from_slice(&chunk[..size]);
            }
            let request: Value = serde_json::from_slice(&bytes[offset..offset + length]).unwrap();
            assert_eq!(request["model"], "fixture-model");
            assert_eq!(request["stream"], true);
            let nonce = request["tools"][0]["parameters"]["properties"]["nonce"]["enum"][0]
                .as_str()
                .unwrap();
            let output = if mode == "missing" {
                json!([])
            } else if turn == 0 {
                json!([{"type":"function_call","name":"hermess_connection_check","call_id":"call_fixture","arguments":json!({"nonce":nonce}).to_string()}])
            } else {
                assert_eq!(
                    request["input"].as_array().unwrap().last().unwrap()["output"],
                    nonce
                );
                assert_eq!(
                    request["input"].as_array().unwrap().last().unwrap()["call_id"],
                    "call_fixture"
                );
                json!([{"type":"message","content":[{"type":"output_text","text":if mode=="wrong" {"incorrect"} else {nonce}}]}])
            };
            let body = format!(
                "data: {}\n\n",
                json!({"type":"response.completed","response":{"status":"completed","output":output}})
            );
            let response=format!("HTTP/1.1 {status} Fixture\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            socket.write_all(response.as_bytes()).unwrap();
        }
    });
    (address, handle)
}

#[tokio::test]
async fn responses_stream_requires_real_tool_round_trip() {
    for (status, mode, stage) in [
        (200, "valid", None),
        (401, "auth", Some("authentication")),
        (404, "endpoint", Some("endpoint")),
        (200, "missing", Some("tool_call")),
        (200, "wrong", Some("tool_result")),
    ] {
        let (url, handle) = fixture(status, mode);
        let result = validate(&url, "fixture-key", &["fixture-model".into()]).await;
        assert_eq!(
            result
                .err()
                .map(|error| serde_json::to_value(error).unwrap()),
            stage.map(|value| json!(value))
        );
        handle.join().unwrap();
    }
    assert!(matches!(
        validate("http://127.0.0.1:1/v1", "fixture-key", &[]).await,
        Err(ValidationStage::Endpoint)
    ));
}

#[test]
fn rejects_incomplete_or_malformed_streams() {
    for bytes in [
        b"data: nope\n\n".as_slice(),
        b"data: {\"type\":\"response.created\"}\n\n",
        b"data: [DONE]\n\n",
    ] {
        assert!(completed(bytes).is_err());
    }
}
