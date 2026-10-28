use super::{valid_shortcut, DEFAULT_SHORTCUT};

#[test]
fn quick_entry_accepts_modified_keys_and_rejects_bare_or_reserved_keys() {
    assert!(valid_shortcut(DEFAULT_SHORTCUT).is_ok());
    assert!(valid_shortcut("Control+Shift+K").is_ok());
    assert!(valid_shortcut("K").is_err());
    assert!(valid_shortcut("Control+Escape").is_err());
    assert!(valid_shortcut("Control+Shift").is_err());
}
