#[cfg(windows)]
use super::{hash_canonical_home, home_hash, native_profile_id};
#[cfg(windows)]
use std::{fs, path::Path};

#[cfg(windows)]
#[test]
fn windows_pipe_hash_uses_plain_path_for_both_spellings() {
    assert_eq!(
        hash_canonical_home(Path::new(r"\\?\C:\Hermess Data\hermes-home")).unwrap(),
        "cee8c47b89f58a35"
    );
    assert_eq!(
        hash_canonical_home(Path::new(r"C:\Hermess Data\hermes-home")).unwrap(),
        "cee8c47b89f58a35"
    );
}

#[cfg(windows)]
#[test]
fn windows_pipe_hash_uses_canonical_extended_path() {
    let home = std::env::temp_dir().join(format!("hermess-gateway-hash-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&home).unwrap();
    let canonical = home.canonicalize().unwrap();
    assert_eq!(
        home_hash(&home).unwrap(),
        hash_canonical_home(&canonical).unwrap()
    );
    fs::remove_dir(&home).unwrap();
}

#[cfg(windows)]
#[test]
fn native_http_profile_must_be_a_direct_child_of_the_owned_root() {
    let root =
        std::env::temp_dir().join(format!("hermess-profile-ticket-{}", uuid::Uuid::new_v4()));
    let profile = root.join("profiles").join("writer");
    let escaped = root.join("other").join("writer");
    fs::create_dir_all(&profile).unwrap();
    fs::create_dir_all(&escaped).unwrap();
    assert!(native_profile_id(&root, &profile)
        .unwrap()
        .ends_with(r"profiles\writer"));
    assert!(native_profile_id(&root, &escaped).is_err());
    fs::remove_dir_all(root).unwrap();
}
