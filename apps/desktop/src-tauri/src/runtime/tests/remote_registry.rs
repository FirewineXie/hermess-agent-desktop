use super::{read_registry, write_registry, SavedRemoteConnection};
use crate::runtime::remote_ssh::SshTarget;
use std::fs;
use uuid::Uuid;

#[test]
fn registry_roundtrip_contains_summaries_only_and_replaces_atomically() {
    let directory =
        std::env::temp_dir().join(format!("hermess-remote-registry-{}", Uuid::new_v4()));
    let path = directory.join("connections.json");
    let entry = SavedRemoteConnection {
        id: Uuid::new_v4().to_string(),
        label: "Work".into(),
        kind: "url".into(),
        base_url: "https://gateway.example".into(),
        auth_mode: "token".into(),
        ssh_target: None,
    };
    write_registry(&path, &[entry.clone()]).unwrap();
    assert_eq!(read_registry(&path).unwrap().len(), 1);
    let bytes = fs::read(&path).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("test-secret"));
    write_registry(&path, &[]).unwrap();
    assert!(read_registry(&path).unwrap().is_empty());
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn registry_rejects_changed_connection_target() {
    let directory =
        std::env::temp_dir().join(format!("hermess-remote-registry-{}", Uuid::new_v4()));
    let path = directory.join("connections.json");
    fs::create_dir_all(&directory).unwrap();
    fs::write(&path, format!(r#"{{"schema":1,"connections":[{{"id":"{}","label":"Work","kind":"url","baseUrl":"https://gateway.example/?token=stale","authMode":"token"}}]}}"#, Uuid::new_v4())).unwrap();
    assert!(read_registry(&path).is_err());
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn registry_accepts_hundred_unicode_label_characters() {
    let directory =
        std::env::temp_dir().join(format!("hermess-remote-registry-{}", Uuid::new_v4()));
    let path = directory.join("connections.json");
    let entry = SavedRemoteConnection {
        id: Uuid::new_v4().to_string(),
        label: "网".repeat(100),
        kind: "url".into(),
        base_url: "https://gateway.example".into(),
        auth_mode: "token".into(),
        ssh_target: None,
    };
    write_registry(&path, &[entry]).unwrap();
    assert_eq!(read_registry(&path).unwrap().len(), 1);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn registry_roundtrips_ssh_target_without_a_token() {
    let directory =
        std::env::temp_dir().join(format!("hermess-remote-registry-{}", Uuid::new_v4()));
    let path = directory.join("connections.json");
    let entry = SavedRemoteConnection {
        id: Uuid::new_v4().to_string(),
        label: "SSH".into(),
        kind: "ssh".into(),
        base_url: "ssh://alice@dev-host:2222/gateway/9030".into(),
        auth_mode: "token".into(),
        ssh_target: Some(SshTarget {
            host: "dev-host".into(),
            user: "alice".into(),
            port: 2222,
            remote_port: 9030,
            key_path: "C:\\Keys\\id_ed25519".into(),
        }),
    };
    write_registry(&path, &[entry]).unwrap();
    assert_eq!(read_registry(&path).unwrap()[0].kind, "ssh");
    let mut changed = read_registry(&path).unwrap();
    changed[0].ssh_target.as_mut().unwrap().remote_port = 9031;
    write_registry(&path, &changed).unwrap();
    assert!(read_registry(&path).is_err());
    let file = String::from_utf8(fs::read(&path).unwrap()).unwrap();
    assert!(!file.contains("test-secret"));
    fs::remove_dir_all(directory).unwrap();
}
