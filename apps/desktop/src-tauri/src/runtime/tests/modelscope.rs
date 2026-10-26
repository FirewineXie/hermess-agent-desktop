use super::{archive_files, declared_name, skill_id};
use std::{io::Write, path::Path};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

fn archive(entries: &[(&str, &str)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, text) in entries {
        writer
            .start_file(
                *name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
        writer.write_all(text.as_bytes()).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[test]
fn accepts_valid_modelscope_bundle() {
    let bytes = archive(&[
        (
            "skill-revision/SKILL.md",
            "---\nname: review-helper\ndescription: Test\n---\n# Test",
        ),
        ("skill-revision/references/guide.md", "Guide"),
    ]);
    let files = archive_files(&bytes).unwrap();
    assert_eq!(declared_name(&files, "fallback").unwrap(), "review-helper");
    assert!(files.contains_key(Path::new("references/guide.md")));
}

#[test]
fn rejects_archive_escape_and_missing_skill() {
    let escape = archive(&[
        ("skill-revision/SKILL.md", "# Test"),
        ("skill-revision/../../escape.txt", "bad"),
    ]);
    assert!(archive_files(&escape).is_err());
    assert!(archive_files(&archive(&[("skill-revision/README.md", "text")])).is_err());
}

#[test]
fn rejects_non_skill_identifiers() {
    assert!(skill_id("modelscope:@owner/skill").is_ok());
    assert!(skill_id("modelscope:@owner/../skill").is_err());
    assert!(skill_id("modelscope:https://example.com/skill").is_err());
}

#[tokio::test]
#[ignore = "requires public ModelScope network"]
async fn live_catalog_and_archive() {
    let browse = super::search("").await.unwrap();
    assert!(!browse["results"].as_array().unwrap().is_empty());
    let results = super::search("modelscope-oauth-skill").await.unwrap();
    assert!(!results["results"].as_array().unwrap().is_empty());
    let identifier = "modelscope:@ModelScope/modelscope-oauth-skill";
    let preview = super::preview(identifier).await.unwrap();
    let scan = super::scan(identifier).await.unwrap();
    assert!(preview["skill_md"].as_str().unwrap().contains("name:"));
    assert_eq!(preview["digest"], scan["digest"]);
    let storage =
        std::env::temp_dir().join(format!("hermess-modelscope-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(storage.join("control")).unwrap();
    let name = super::install(
        &storage,
        identifier,
        scan["digest"].as_str().unwrap(),
        true,
        &[],
    )
    .await
    .unwrap()["name"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        super::installed(&storage).unwrap()["identifiers"][identifier]
            .as_bool()
            .unwrap()
    );
    assert!(storage
        .join("hermes-home")
        .join("skills")
        .join(super::local_name("@ModelScope/modelscope-oauth-skill"))
        .join("SKILL.md")
        .is_file());
    super::uninstall(&storage, &name).unwrap();
    assert!(super::installed(&storage).unwrap()["identifiers"][identifier].is_null());
    std::fs::remove_dir_all(storage).unwrap();
}
