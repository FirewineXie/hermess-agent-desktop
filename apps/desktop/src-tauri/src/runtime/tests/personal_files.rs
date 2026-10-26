use super::{
    decode, file_version, memory_text, parse_entries, read_bytes, write_checked, ENTRY_DELIMITER,
};
use std::{fs, path::Path};
use uuid::Uuid;

#[test]
fn memory_entries_follow_upstream_delimiter_and_utf8_bom() {
    let raw = decode(Some(b"\xef\xbb\xbfFirst\n\xc2\xa7\nSecond\nline")).unwrap();
    assert_eq!(parse_entries(&raw), ["First", "Second\nline"]);
    assert_eq!(["First", "Second\nline"].join(ENTRY_DELIMITER), raw);
}

#[test]
fn memory_save_checks_unicode_capacity_and_duplicate_entries() {
    assert_eq!(memory_text(&["中文".into()], 2).unwrap(), "中文");
    assert!(memory_text(&["中文".into()], 1).is_err());
    assert!(memory_text(&["重复".into(), "重复".into()], 20).is_err());
    assert!(memory_text(&["a\n§\nb".into()], 20).is_err());
}

#[test]
fn file_save_rejects_external_change_without_overwriting_it() {
    let root = std::env::temp_dir().join(format!("hermess-personal-file-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let path = root.join("SOUL.md");
    let lock = root.join("SOUL.md.lock");
    write_checked(&path, &lock, "missing", "初始内容").unwrap();
    let old_version = file_version(read_bytes(&path).unwrap().as_deref());
    fs::write(&path, "外部修改").unwrap();
    assert!(matches!(
        write_checked(&path, &lock, &old_version, "旧草稿"),
        Err(_)
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), "外部修改");
    let current = file_version(read_bytes(&path).unwrap().as_deref());
    write_checked(&path, &lock, &current, "更新内容").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "更新内容");
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn reject_symlink_or_non_file_targets() {
    let root = std::env::temp_dir().join(format!("hermess-personal-dir-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    assert!(matches!(read_bytes(Path::new(&root)), Err(_)));
    fs::remove_dir_all(&root).unwrap();
}
