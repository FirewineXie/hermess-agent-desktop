use super::{valid_profile_name, SessionOwners};
use crate::errors::{SESSION_OWNER_UNKNOWN, SESSION_PROFILE_MISMATCH};

#[test]
fn profile_names_cannot_escape_the_product_home() {
    assert!(valid_profile_name("default"));
    assert!(valid_profile_name("team_2"));
    assert!(!valid_profile_name(""));
    assert!(!valid_profile_name("../other"));
    assert!(!valid_profile_name("Team"));
    assert!(!valid_profile_name(&"a".repeat(65)));
}

#[test]
fn session_owner_is_a_profile_and_session_pair() {
    let owners = SessionOwners::default();
    assert_eq!(
        owners.ensure("alpha", "session-a").unwrap_err(),
        SESSION_OWNER_UNKNOWN
    );
    owners.record("alpha", "session-a").unwrap();
    assert!(owners.ensure("alpha", "session-a").is_ok());
    assert_eq!(
        owners.ensure("beta", "session-a").unwrap_err(),
        SESSION_PROFILE_MISMATCH
    );
    // Distinct profiles may legitimately use the same session ID.
    owners.record("beta", "session-a").unwrap();
    assert!(owners.ensure("beta", "session-a").is_ok());
    assert!(owners.ensure("alpha", "session-a").is_ok());
    assert_eq!(
        owners.ensure("gamma", "session-a").unwrap_err(),
        SESSION_PROFILE_MISMATCH
    );
}
