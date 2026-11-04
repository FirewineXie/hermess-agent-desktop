use super::{setup_command_path, valid_rename, RESPONSE_LIMIT, SETUP_COMMAND_LIMIT};

#[test]
fn internal_id_rename_rejects_default_same_and_invalid_names() {
    assert!(valid_rename("writer", "research_writer"));
    assert!(!valid_rename("default", "writer"));
    assert!(!valid_rename("writer", "default"));
    assert!(!valid_rename("writer", "writer"));
    assert!(!valid_rename("writer", "Bad Name"));
}

#[test]
fn profile_identity_response_limit_is_bounded() {
    assert_eq!(RESPONSE_LIMIT, 1024 * 1024);
    assert_eq!(SETUP_COMMAND_LIMIT, 16 * 1024);
}

#[test]
fn profile_setup_command_uses_locked_receiver_route() {
    assert_eq!(
        setup_command_path("research_writer"),
        "/api/profiles/research_writer/setup-command"
    );
}
