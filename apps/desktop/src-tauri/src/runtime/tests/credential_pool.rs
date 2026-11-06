use super::{add_body, pool_path, provider};
use serde_json::json;

#[test]
fn pool_fields_are_validated() {
    assert!(
        add_body(&json!({"provider":"OpenRouter","api_key":"fake-test-key","label":"test"}))
            .is_ok()
    );
    assert!(add_body(&json!({"provider":"bad/provider","api_key":"fake-test-key"})).is_err());
    assert!(add_body(&json!({"provider":"openrouter","api_key":""})).is_err());
    assert_eq!(
        provider(&json!({"provider":"OpenRouter"})).unwrap(),
        "openrouter"
    );
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_credential_pool_shapes() {
    let path = pool_path(1420, "default", None).unwrap();
    let body = add_body(&json!({"provider":"custom:codex-smoke","api_key":"fake-pool-test-key","label":"test account"})).unwrap();
    let delete_path = pool_path(1420, "default", Some(("custom:codex-smoke", 1))).unwrap();
    println!("POOL_SHAPE={}", json!({"method":"GET","path":path}));
    println!(
        "POOL_SHAPE={}",
        json!({"method":"POST","path":path,"body":body})
    );
    println!(
        "POOL_SHAPE={}",
        json!({"method":"DELETE","path":delete_path})
    );
}
