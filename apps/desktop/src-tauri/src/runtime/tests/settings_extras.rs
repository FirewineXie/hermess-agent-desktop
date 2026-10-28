use super::memory_provider_path;

#[test]
fn memory_provider_path_encodes_untrusted_segments() {
    assert_eq!(
        memory_provider_path("team/provider", "/config").expect("valid provider"),
        "/api/memory/providers/team%2Fprovider/config"
    );
    assert!(memory_provider_path("bad\nprovider", "/config").is_err());
    assert!(memory_provider_path("", "/config").is_err());
}
