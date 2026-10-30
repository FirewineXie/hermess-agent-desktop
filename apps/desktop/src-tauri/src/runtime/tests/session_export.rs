use super::write_new_export;
use std::fs;

#[test]
fn writes_new_export_without_overwriting_existing_file() {
    let directory =
        std::env::temp_dir().join(format!("hermess-export-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&directory).unwrap();
    let target = directory.join("会话.md");
    assert!(write_new_export(&target, "第一版".as_bytes()).unwrap());
    assert_eq!(fs::read_to_string(&target).unwrap(), "第一版");
    assert!(write_new_export(&target, "第二版".as_bytes()).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "第一版");
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    fs::remove_dir_all(directory).unwrap();
}
