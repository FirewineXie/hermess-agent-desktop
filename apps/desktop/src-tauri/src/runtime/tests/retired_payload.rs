use super::{cleanup, owner_marker, MARKER_CONTENT};
use std::{fs, os::windows::fs::OpenOptionsExt};
use uuid::Uuid;

#[test]
fn removes_only_marked_retired_runtime_directories() {
    let runtime = std::env::temp_dir().join(format!("hermess-retired-{}", Uuid::new_v4()));
    let retired = runtime.join("payload.old-20261027214300-0");
    let unmarked = runtime.join("payload.old-20261027214301-0");
    let orphaned = runtime.join("payload.old-20261027214302-0");
    let active = runtime.join("payload");
    fs::create_dir_all(&retired).unwrap();
    fs::create_dir_all(&unmarked).unwrap();
    fs::create_dir_all(&active).unwrap();
    fs::write(owner_marker(&retired), MARKER_CONTENT).unwrap();
    fs::write(owner_marker(&orphaned), MARKER_CONTENT).unwrap();
    fs::write(retired.join("file"), "old").unwrap();
    fs::write(active.join("file"), "active").unwrap();

    assert_eq!(cleanup(&runtime).unwrap(), 1);
    assert!(!retired.exists());
    assert!(!owner_marker(&retired).exists());
    assert!(!owner_marker(&orphaned).exists());
    assert!(unmarked.exists());
    assert_eq!(fs::read_to_string(active.join("file")).unwrap(), "active");
    fs::remove_dir_all(runtime).unwrap();
}

#[test]
fn interrupted_cleanup_keeps_its_owner_marker_for_retry() {
    let runtime = std::env::temp_dir().join(format!("hermess-retired-{}", Uuid::new_v4()));
    let retired = runtime.join("payload.old-20261027214303-0");
    fs::create_dir_all(&retired).unwrap();
    fs::write(owner_marker(&retired), MARKER_CONTENT).unwrap();
    let file = retired.join("locked");
    fs::write(&file, "old").unwrap();
    let handle = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&file)
        .unwrap();

    assert!(cleanup(&runtime).is_err());
    assert!(owner_marker(&retired).exists());
    drop(handle);
    assert_eq!(cleanup(&runtime).unwrap(), 1);
    assert!(!retired.exists());
    fs::remove_dir_all(runtime).unwrap();
}
