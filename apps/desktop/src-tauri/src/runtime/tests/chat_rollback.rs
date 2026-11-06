use super::{checkpoint_params, restore_params, session_params};
use serde_json::json;

#[test]
fn rollback_list_and_diff_match_the_locked_gateway_contract() {
    assert_eq!(
        session_params("runtime-session").unwrap(),
        json!({"session_id":"runtime-session"})
    );
    assert_eq!(
        checkpoint_params("runtime-session", "abcdef1").unwrap(),
        json!({"session_id":"runtime-session","hash":"abcdef1"})
    );
}

#[test]
fn rollback_restore_omits_false_and_sends_only_supported_optional_fields() {
    assert_eq!(
        restore_params("runtime-session", "1", Some("src/a file.ts".into()), None).unwrap(),
        json!({"session_id":"runtime-session","hash":"1","file_path":"src/a file.ts"})
    );
    assert_eq!(
        restore_params("runtime-session", "1", None, Some(true)).unwrap(),
        json!({"session_id":"runtime-session","hash":"1","all":true})
    );
    assert_eq!(
        restore_params("runtime-session", "1", None, Some(false)).unwrap(),
        json!({"session_id":"runtime-session","hash":"1"})
    );
}

#[test]
fn rollback_restore_rejects_ambiguous_or_invalid_inputs() {
    assert!(session_params("").is_err());
    assert!(checkpoint_params("runtime-session", "bad hash").is_err());
    assert!(restore_params("runtime-session", "1", Some("src/a.ts".into()), Some(true)).is_err());
    assert!(restore_params("runtime-session", "1", Some("bad\0path".into()), None).is_err());
}

#[test]
#[ignore = "prints production request shapes for the locked Gateway integration test"]
fn print_production_rollback_shapes() {
    let session = std::env::var("HERMESS_TEST_SESSION_ID").unwrap();
    let hash = std::env::var("HERMESS_TEST_CHECKPOINT_HASH").unwrap();
    let file = std::env::var("HERMESS_TEST_ROLLBACK_FILE").unwrap();
    println!(
        "PRODUCTION_ROLLBACK_SHAPES={}",
        json!({
            "list": ["rollback.list", session_params(&session).unwrap()],
            "diff": ["rollback.diff", checkpoint_params(&session, &hash).unwrap()],
            "file": ["rollback.restore", restore_params(&session, &hash, Some(file), None).unwrap()],
            "safe": ["rollback.restore", restore_params(&session, &hash, None, None).unwrap()],
            "all": ["rollback.restore", restore_params(&session, &hash, None, Some(true)).unwrap()],
        })
    );
}
