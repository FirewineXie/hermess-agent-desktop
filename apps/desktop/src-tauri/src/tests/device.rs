use super::{validate_preferences, Preferences};

#[test]
fn requires_a_valid_modified_global_shortcut() {
    let mut preferences = Preferences::default();
    assert!(validate_preferences(&preferences).is_ok());
    for invalid in ["A", "not-a-shortcut", "Ctrl++"] {
        preferences.shortcut = invalid.into();
        assert!(validate_preferences(&preferences).is_err());
    }
    preferences.shortcut = "CommandOrControl+Shift+K".into();
    assert!(validate_preferences(&preferences).is_ok());
}

#[cfg(windows)]
#[test]
fn native_power_request_can_be_acquired_and_released() {
    let guard = crate::device_power::WakeGuard::acquire()
        .expect("Windows power request should be available");
    drop(guard);
}

#[test]
fn power_status_does_not_hide_a_shortcut_registration_error() {
    let inner = super::Inner {
        error: Some("shortcut conflict".into()),
        wake_error: Some("power denied".into()),
        ..Default::default()
    };
    assert_eq!(
        super::status(&inner).error.as_deref(),
        Some("shortcut conflict")
    );
}
