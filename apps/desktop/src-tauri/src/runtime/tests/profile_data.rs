#[cfg(windows)]
use super::display_path;
use super::{checked_directory, list_directory};
use std::fs;

#[test]
fn profile_data_directory_stays_under_its_owner() {
    let storage =
        std::env::temp_dir().join(format!("hermess-profile-data-{}", uuid::Uuid::new_v4()));
    let root = storage.join("hermes-home");
    let coder = root.join("profiles").join("coder");
    fs::create_dir_all(&coder).unwrap();

    assert_eq!(
        checked_directory(&root, &storage, "default").unwrap(),
        root.to_string_lossy()
    );
    assert_eq!(
        checked_directory(&coder, &storage, "coder").unwrap(),
        coder.to_string_lossy()
    );
    assert!(checked_directory(&root, &storage, "coder").is_err());
    assert!(checked_directory(&coder, &storage, "other").is_err());
    fs::write(coder.join("note.txt"), "sample").unwrap();
    let root_listing = list_directory(&coder, &storage, "coder", "").unwrap();
    assert_eq!(root_listing.entries.len(), 1);
    assert_eq!(root_listing.entries[0].name, "note.txt");
    assert!(list_directory(&coder, &storage, "coder", "../default").is_err());
    assert!(list_directory(&coder, &storage, "coder", coder.to_str().unwrap()).is_err());

    #[cfg(windows)]
    assert_eq!(
        display_path(std::path::Path::new(r"\\?\E:\sample")),
        r"E:\sample"
    );

    fs::remove_dir_all(storage).unwrap();
}
