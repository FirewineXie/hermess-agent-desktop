use super::client;

#[test]
fn loopback_requests_share_one_connection_pool() {
    assert!(std::ptr::eq(client().unwrap(), client().unwrap()));
}
