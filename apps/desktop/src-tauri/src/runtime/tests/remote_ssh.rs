use super::{classify_failure, forward_args, forward_ready, ssh_args, target_label, SshTarget};

#[test]
fn ssh_arguments_reject_option_injection_and_keep_target_separate() {
    assert!(ssh_args("-oProxyCommand=bad", "", 22, "").is_err());
    assert!(ssh_args("host name", "", 22, "").is_err());
    assert!(ssh_args("host", "name@other", 22, "").is_err());
    assert!(ssh_args("host", "", 22, "-oBad").is_err());
    let args = ssh_args("dev-host", "alice", 2222, "C:\\Keys\\id_ed25519").unwrap();
    assert_eq!(
        args.iter().position(|arg| arg == "--"),
        Some(args.len() - 3)
    );
    assert_eq!(args[args.len() - 2], "alice@dev-host");
    assert_eq!(args[args.len() - 1], "uname -s");
    assert!(args.windows(2).any(|pair| pair == ["-p", "2222"]));
}

#[test]
fn ssh_errors_are_classified_without_returning_stderr() {
    assert_eq!(
        classify_failure("Permission denied (publickey)."),
        "auth_failed"
    );
    assert_eq!(
        classify_failure("REMOTE HOST IDENTIFICATION HAS CHANGED!"),
        "host_key_changed"
    );
    assert_eq!(classify_failure("Connection refused"), "unreachable");
    assert_eq!(classify_failure("unexpected detail"), "ssh_failed");
}

#[test]
fn ssh_forward_is_local_only_and_has_no_remote_command() {
    let target = SshTarget {
        host: "dev-host".into(),
        user: "alice".into(),
        port: 2222,
        remote_port: 9030,
        key_path: String::new(),
    };
    assert_eq!(
        target_label(&target).unwrap(),
        "ssh://alice@dev-host:2222/gateway/9030"
    );
    let args = forward_args(&target, 41234).unwrap();
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-L", "127.0.0.1:41234:127.0.0.1:9030"]));
    assert!(args.iter().any(|arg| arg == "ExitOnForwardFailure=yes"));
    assert_eq!(args[args.len() - 2], "--");
    assert_eq!(args[args.len() - 1], "alice@dev-host");
    assert!(!args.iter().any(|arg| arg == "uname -s"));
    assert!(args.iter().any(|arg| arg == "-v"));
    assert!(forward_ready(
        b"debug1: Local forwarding listening on 127.0.0.1 port 41234.\r\n",
        41234
    ));
    assert!(!forward_ready(
        b"debug1: Local forwarding listening on 127.0.0.1 port 412345.\r\n",
        41234
    ));
}
