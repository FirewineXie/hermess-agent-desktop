use super::{list_workspace_panel_directory, read_workspace_panel_file};
use std::fs;
use uuid::Uuid;

#[test]
fn reads_utf8_text_and_rejects_relative_paths() {
    assert!(read_workspace_panel_file("relative.txt".into()).is_err());
    let path = std::env::temp_dir().join(format!("hermess-panel-{}.txt", Uuid::new_v4()));
    fs::write(&path, "中文与 emoji 😀").unwrap();
    let file = read_workspace_panel_file(path.to_string_lossy().into_owned()).unwrap();
    assert_eq!(file.kind, "text");
    assert_eq!(file.content, "中文与 emoji 😀");
    fs::remove_file(path).unwrap();
}

#[test]
fn lists_immediate_children_with_folders_first() {
    assert!(list_workspace_panel_directory(Some("relative-folder".into())).is_err());
    let root = std::env::temp_dir().join(format!("hermess-tree-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("folder")).unwrap();
    fs::write(root.join("file.txt"), "content").unwrap();
    let listed = list_workspace_panel_directory(Some(root.to_string_lossy().into_owned())).unwrap();
    assert_eq!(listed.entries.len(), 2);
    assert!(listed.entries[0].directory);
    assert_eq!(listed.entries[0].name, "folder");
    assert!(!listed.entries[1].directory);
    assert_eq!(listed.entries[1].name, "file.txt");
    fs::remove_dir_all(root).unwrap();
}
