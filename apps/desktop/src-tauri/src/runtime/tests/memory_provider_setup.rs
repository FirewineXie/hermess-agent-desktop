use super::{valid_provider_name, RESULT_PREFIX, SCRIPT};

#[test]
fn provider_name_is_a_bounded_identifier() {
    for value in ["honcho", "retain-db", "memory_2", "A1"] {
        assert!(valid_provider_name(value));
    }
    for value in [
        "",
        "-honcho",
        "../honcho",
        "honcho setup",
        "honcho;whoami",
        "记忆",
    ] {
        assert!(!valid_provider_name(value));
    }
    assert!(!valid_provider_name(&"a".repeat(65)));
}

#[test]
fn helper_projects_only_status_metadata() {
    assert!(SCRIPT.contains(RESULT_PREFIX));
    assert!(SCRIPT.contains("contextlib.redirect_stdout"));
    assert!(SCRIPT.contains("contextlib.redirect_stderr"));
    assert!(SCRIPT.contains("(\"kind\",\"status\")"));
    assert!(!SCRIPT.contains("item.get(\"command\")"));
    assert!(!SCRIPT.contains("item.get(\"stdout\")"));
    assert!(!SCRIPT.contains("item.get(\"stderr\")"));
}
