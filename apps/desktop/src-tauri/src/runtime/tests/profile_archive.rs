use super::{
    copy_new, export_archive_extension, import_archive_extension, validate_export_destination,
    validate_import_archive,
};
use std::fs;

#[test]
fn archive_paths_require_supported_regular_files_and_new_destinations() {
    let root = std::env::temp_dir().join(format!("hermess-profile-archive-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let archive = root.join("expert.tar.gz");
    fs::write(&archive, b"not inspected here").unwrap();
    assert!(export_archive_extension(&archive));
    assert!(import_archive_extension(&archive));
    assert!(validate_import_archive(&archive).is_ok());
    assert!(validate_export_destination(&archive).is_err());
    assert!(validate_export_destination(&root.join("new.tar.gz")).is_ok());
    assert!(validate_export_destination(&root.join("new.tgz")).is_err());
    assert!(validate_import_archive(&root.join("missing.tgz")).is_err());
    assert!(validate_import_archive(&root.join("missing.tar.gz")).is_err());
    assert!(!import_archive_extension(&root.join("expert.zip")));
    let source = root.join("source.bin");
    let destination = root.join("copied.bin");
    fs::write(&source, b"portable").unwrap();
    assert_eq!(copy_new(&source, &destination).unwrap(), 8);
    assert_eq!(fs::read(&destination).unwrap(), b"portable");
    assert!(copy_new(&source, &destination).is_err());
    assert_eq!(fs::read(&destination).unwrap(), b"portable");
    fs::remove_dir_all(&root).unwrap();
}
