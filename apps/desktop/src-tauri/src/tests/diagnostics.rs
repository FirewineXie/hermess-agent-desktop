use super::RuntimeProbe;

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
