use super::{filesystem_path, plain_path, CanonicalizePlain};
use std::path::Path;

#[cfg(windows)]
#[test]
fn windows_paths_use_plain_spelling() {
    assert_eq!(
        plain_path(Path::new(r"\\?\C:\Hermess Data\file.txt")),
        Path::new(r"C:\Hermess Data\file.txt")
    );
    assert_eq!(
        plain_path(Path::new(r"\\?\UNC\host\share\file.txt")),
        Path::new(r"\\host\share\file.txt")
    );
    assert_eq!(
        plain_path(Path::new(r"C:\Hermess Data\file.txt")),
        Path::new(r"C:\Hermess Data\file.txt")
    );
}

#[cfg(windows)]
#[test]
fn canonical_path_supports_plain_reads_and_writes() {
    let root = std::env::temp_dir().join(format!("hermess-plain-path-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let plain = root.canonicalize_plain().unwrap();
    assert!(!plain.to_string_lossy().starts_with(r"\\?\"));
    let file = plain.join("sample.txt");
    std::fs::write(&file, "中文").unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "中文");
    std::fs::remove_dir_all(&root).unwrap();
}

#[cfg(windows)]
#[test]
fn deep_filesystem_path_is_temporary_and_not_an_identity() {
    let root = std::env::temp_dir().join(format!("hermess-deep-path-{}", uuid::Uuid::new_v4()));
    let deep = (0..5).fold(root.clone(), |path, index| {
        path.join(format!("{index}-{}", "a".repeat(48)))
    });
    let internal = filesystem_path(&deep);
    assert!(internal.to_string_lossy().starts_with(r"\\?\"));
    assert_eq!(plain_path(&internal), deep);
    std::fs::create_dir_all(&internal).unwrap();
    assert_eq!(deep.canonicalize_plain().unwrap(), deep);
    let file = deep.join("sample.txt");
    std::fs::write(filesystem_path(&file), "中文").unwrap();
    assert_eq!(
        std::fs::read_to_string(filesystem_path(&file)).unwrap(),
        "中文"
    );
    std::fs::remove_file(filesystem_path(&file)).unwrap();
    let mut directory = deep;
    while directory != root {
        std::fs::remove_dir(filesystem_path(&directory)).unwrap();
        directory.pop();
    }
    std::fs::remove_dir(root).unwrap();
}

#[cfg(windows)]
#[test]
fn filesystem_path_keeps_dot_segments_in_win32_form() {
    let base = std::env::temp_dir().join(format!("hermess-dot-path-{}", uuid::Uuid::new_v4()));
    let root = (0..5).fold(base.clone(), |path, index| {
        path.join(format!("{index}-{}", "a".repeat(48)))
    });
    std::fs::create_dir_all(filesystem_path(&root.join("child"))).unwrap();
    for path in [root.join("child/.."), root.join("child/.")] {
        assert_eq!(filesystem_path(&path), path);
        assert!(filesystem_path(&path).is_dir());
    }
    std::fs::remove_dir_all(filesystem_path(&base)).unwrap();
}

#[cfg(not(windows))]
#[test]
fn other_platform_paths_are_unchanged() {
    assert_eq!(
        plain_path(Path::new("/tmp/file.txt")),
        Path::new("/tmp/file.txt")
    );
    assert_eq!(
        filesystem_path(Path::new("/tmp/file.txt")),
        Path::new("/tmp/file.txt")
    );
}
