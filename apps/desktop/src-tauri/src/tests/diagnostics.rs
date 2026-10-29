use super::RuntimeProbe;

#[test]
fn client_error_detail_stays_on_one_bounded_log_line() {
    let detail = format!("错误\n{}", "x".repeat(3000));
    let logged = super::bounded_error_detail(&detail);
    assert!(!logged.contains('\n'));
    assert_eq!(logged.chars().count(), 2048);
    assert!(logged.starts_with("错误 "));
}

#[test]
fn npm_version_probe_accepts_only_numeric_versions() {
    assert!(super::is_numeric_version("10.9.2"));
    assert!(super::is_numeric_version("11.0.0-rc.1"));
    assert!(!super::is_numeric_version("npm: command not found"));
    assert!(!super::is_numeric_version("10.9"));
}

#[test]
fn runtime_probes_serialize_contract_fields() {
    use serde_json::json;
    assert_eq!(
        serde_json::to_value(RuntimeProbe {
            tool: "Python",
            kind: "runtime",
            path: Some("example-tools/python".into()),
            version: Some("Python 3.14 CPython AMD64".into()),
            usable: true,
            reason: String::new(),
        })
        .unwrap(),
        json!({
            "tool": "Python", "kind": "runtime", "path": "example-tools/python",
            "version": "Python 3.14 CPython AMD64", "usable": true, "reason": ""
        })
    );
    assert_eq!(
        serde_json::to_value(RuntimeProbe {
            tool: "Git",
            kind: "command",
            path: None,
            version: None,
            usable: false,
            reason: "没有找到可执行文件".into(),
        })
        .unwrap(),
        json!({
            "tool": "Git", "kind": "command", "path": null,
            "version": null, "usable": false, "reason": "没有找到可执行文件"
        })
    );
}

#[tokio::test]
async fn chromium_output_uses_separate_diagnostic_log() {
    use std::fs;
    use tokio::io::AsyncWriteExt;

    let selected =
        std::env::temp_dir().join(format!("hermess-browser-logs-{}", uuid::Uuid::new_v4()));
    let storage = selected.join("HermessAgentDesktop");
    fs::create_dir_all(&storage).unwrap();
    let (mut writer, reader) = tokio::io::duplex(1024);
    let capture = tokio::spawn(super::capture_browser_output(
        storage.clone(),
        reader,
        "default/stderr".into(),
    ));
    writer.write_all(b"DevTools listening\n").await.unwrap();
    drop(writer);
    capture.await.unwrap();

    let files = super::daily_log_files(&storage, "chromium-").unwrap();
    assert_eq!(files.len(), 1);
    let browser_logs =
        super::read_diagnostic_logs(selected.to_string_lossy().into_owned(), "browser".into())
            .unwrap();
    assert!(browser_logs.contains("[default/stderr] DevTools listening"));
    let client_logs =
        super::read_diagnostic_logs(selected.to_string_lossy().into_owned(), "client".into())
            .unwrap();
    assert!(!client_logs.contains("DevTools listening"));
    fs::remove_dir_all(selected).unwrap();
}
