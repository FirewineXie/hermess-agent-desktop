#[cfg(windows)]
use super::directory_exceeds_limit;
use super::valid_value;
#[cfg(windows)]
use std::fs;

#[cfg(windows)]
#[test]
fn cache_size_check_stops_after_crossing_limit() {
    let root = std::env::temp_dir().join(format!("hermess-webview-cache-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("Default/Cache")).unwrap();
    fs::write(root.join("Default/Cache/entry"), [1u8; 8]).unwrap();
    assert!(!directory_exceeds_limit(&root, 8).unwrap());
    assert!(directory_exceeds_limit(&root, 7).unwrap());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn policy_accepts_only_supported_choices() {
    if cfg!(windows) {
        assert!(valid_value(512));
        assert!(!valid_value(30));
    } else if cfg!(target_os = "macos") {
        assert!(valid_value(30));
        assert!(!valid_value(512));
    } else {
        assert!(!valid_value(0));
    }
}
