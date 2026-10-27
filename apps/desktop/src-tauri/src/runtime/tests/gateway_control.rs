#[cfg(windows)]
use super::{hash_canonical_home, home_hash};
#[cfg(windows)]
use std::{fs, path::Path};

#[cfg(windows)]
#[test]
fn windows_pipe_hash_keeps_extended_path_prefix() {
    // Pinned Hermes: sha256(os.path.normcase(str(Path(home).resolve())).encode())[:8].
    assert_eq!(
        hash_canonical_home(
            Path::new(r"\\?\C:\Hermess Data\hermes-home"),
            Path::new(r"\\?\C:\Hermess Data\hermes-home")
        )
        .unwrap(),
        "d500ad405a1f4f16"
    );
    assert_eq!(
        hash_canonical_home(
            Path::new(r"C:\Hermess Data\hermes-home"),
            Path::new(r"\\?\C:\Hermess Data\hermes-home")
        )
        .unwrap(),
        "cee8c47b89f58a35"
    );
}

#[cfg(windows)]
#[test]
fn windows_pipe_hash_uses_canonical_extended_path() {
    let home = std::env::temp_dir().join(format!("hermess-gateway-hash-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&home).unwrap();
    let canonical = home.canonicalize().unwrap();
    assert!(canonical.to_string_lossy().starts_with(r"\\?\"));
    assert_eq!(
        home_hash(&home).unwrap(),
        hash_canonical_home(&home, &canonical).unwrap()
    );
    fs::remove_dir(&home).unwrap();
}
