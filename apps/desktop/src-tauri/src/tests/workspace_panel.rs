use super::read_workspace_panel_file;
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
