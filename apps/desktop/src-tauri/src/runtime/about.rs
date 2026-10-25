use crate::errors::DesktopFailure;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductInfo {
    version: &'static str,
    hermes_version: String,
    hermes_commit: String,
    product_license: &'static str,
    hermes_license: &'static str,
}

#[tauri::command]
pub fn get_product_info() -> Result<ProductInfo, DesktopFailure> {
    let lock: Value =
        serde_json::from_str(include_str!("../../../../../runtime/upstream.lock.json"))
            .map_err(|_| DesktopFailure::operation_failed())?;
    let hermes_version = lock
        .get("tag")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::operation_failed)?;
    let hermes_commit = lock
        .get("commit")
        .and_then(Value::as_str)
        .ok_or_else(DesktopFailure::operation_failed)?;
    Ok(ProductInfo {
        version: env!("CARGO_PKG_VERSION"),
        hermes_version: hermes_version.to_owned(),
        hermes_commit: hermes_commit.to_owned(),
        product_license: include_str!("../../../../../LICENSE"),
        hermes_license: include_str!("../../../../../legal/hermes-agent-LICENSE"),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn product_info_exposes_the_bundled_version_and_license_fields() {
        let value = serde_json::to_value(super::get_product_info().unwrap()).unwrap();
        let lock: serde_json::Value =
            serde_json::from_str(include_str!("../../../../../runtime/upstream.lock.json"))
                .unwrap();
        assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value["hermesVersion"], lock["tag"]);
        assert_eq!(value["hermesCommit"], lock["commit"]);
        assert!(value["productLicense"]
            .as_str()
            .unwrap()
            .starts_with("# PolyForm Noncommercial License"));
        assert!(value["hermesLicense"]
            .as_str()
            .unwrap()
            .starts_with("MIT License"));
    }
}
