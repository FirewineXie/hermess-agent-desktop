use super::safe_pairing_id;

#[test]
fn pairing_id_cannot_escape_the_gateway_route() {
    assert!(safe_pairing_id("81d4a74a-f704-4867-915a-824b7eb2e044"));
    assert!(!safe_pairing_id("../api/env"));
    assert!(!safe_pairing_id("a?profile=other"));
}
