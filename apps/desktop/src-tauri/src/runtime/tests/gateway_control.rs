#[cfg(windows)]
use super::{hash_canonical_home, home_hash};
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
