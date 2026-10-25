#[test]
fn product_info_exposes_the_bundled_version_and_license_fields() {
    let value = serde_json::to_value(super::get_product_info().unwrap()).unwrap();
    let lock: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../runtime/upstream.lock.json"
    )))
    .unwrap();
    assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(value["hermesVersion"], lock["tag"]);
    assert_eq!(value["hermesCommit"], lock["commit"]);
    assert!(value["productLicense"]
        .as_str()
        .unwrap()
        .starts_with("# PolyForm Strict License 1.0.0"));
    assert!(value["hermesLicense"]
        .as_str()
        .unwrap()
        .starts_with("MIT License"));
}
