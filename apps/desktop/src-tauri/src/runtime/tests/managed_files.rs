use super::{operate, sensitive};
use crate::paths::CanonicalizePlain;
use serde_json::json;
use std::fs;
use uuid::Uuid;

fn fixture() -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("hermess-managed-files-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    root
}

#[test]
fn browse_copy_preview_and_delete_stay_in_selected_root() {
    let root = fixture();
    let source = root
        .parent()
        .unwrap()
        .join(format!("hermess-upload-{}.txt", Uuid::new_v4()));
    fs::write(&source, "hello managed files").unwrap();
    let output = root
        .parent()
        .unwrap()
        .join(format!("hermess-download-{}.txt", Uuid::new_v4()));
    let path = root.to_string_lossy().into_owned();
    let source_path = source.to_string_lossy().into_owned();
    let folder = root.join("drafts").to_string_lossy().into_owned();
    let result = operate(
        &root,
        "managedFiles.mkdir",
        &json!({"root":path,"path":path,"name":"drafts"}),
    )
    .unwrap();
    let resolved_folder = root.canonicalize_plain().unwrap().join("drafts");
    assert_eq!(result["path"], resolved_folder.to_string_lossy().as_ref());
    let uploaded = operate(
        &root,
        "managedFiles.upload",
        &json!({"root":path,"path":folder,"sources":[source_path]}),
    )
    .unwrap();
    assert_eq!(uploaded["copied"], 1);
    let file = root.join("drafts").join(source.file_name().unwrap());
    let file_path = file.to_string_lossy().into_owned();
    let listing = operate(
        &root,
        "managedFiles.list",
        &json!({"root":path,"path":folder}),
    )
    .unwrap();
    assert_eq!(listing["entries"].as_array().unwrap().len(), 1);
    assert_eq!(
        operate(
            &root,
            "managedFiles.read",
            &json!({"root":path,"path":file_path})
        )
        .unwrap()["content"],
        "hello managed files"
    );
    operate(
        &root,
        "managedFiles.copyOut",
        &json!({"root":path,"path":file_path,"destination":output.to_string_lossy()}),
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&output).unwrap(), "hello managed files");
    assert!(operate(
        &root,
        "managedFiles.delete",
        &json!({"root":path,"path":path})
    )
    .is_err());
    operate(
        &root,
        "managedFiles.delete",
        &json!({"root":path,"path":folder}),
    )
    .unwrap();
    assert!(!root.join("drafts").exists());
    fs::remove_file(source).unwrap();
    fs::remove_file(output).unwrap();
    fs::remove_dir(root).unwrap();
}

#[test]
fn sensitive_and_outside_paths_are_rejected() {
    let root = fixture();
    let outside = root
        .parent()
        .unwrap()
        .join(format!("hermess-outside-{}.txt", Uuid::new_v4()));
    fs::write(&outside, "outside").unwrap();
    fs::write(root.join(".env"), "secret").unwrap();
    let path = root.to_string_lossy().into_owned();
    let listing = operate(&root, "managedFiles.list", &json!({"root":path})).unwrap();
    assert!(listing["entries"].as_array().unwrap().is_empty());
    assert!(sensitive(&root.join("pairing").join("approval.json")));
    assert!(operate(
        &root,
        "managedFiles.read",
        &json!({"root":path,"path":outside.to_string_lossy()})
    )
    .is_err());
    assert!(operate(
        &root,
        "managedFiles.mkdir",
        &json!({"root":path,"path":path,"name":".."})
    )
    .is_err());
    fs::remove_file(outside).unwrap();
    fs::remove_file(root.join(".env")).unwrap();
    fs::remove_dir(root).unwrap();
}
