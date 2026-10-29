use super::{copy_into_profile, inspect, valid_name};
use std::fs;

#[cfg(windows)]
#[test]
fn deep_package_scan_keeps_relative_paths_plain() {
    use super::collect;
    use crate::paths::filesystem_path;

    let base = std::env::temp_dir().join(format!("workbuddy-deep-{}", uuid::Uuid::new_v4()));
    let root = (0..5).fold(base.clone(), |path, index| {
        path.join(format!("{index}-{}", "a".repeat(48)))
    });
    let nested = root.join("nested");
    fs::create_dir_all(filesystem_path(&nested)).unwrap();
    fs::write(filesystem_path(&nested.join("note.txt")), b"content").unwrap();

    let mut files = Vec::new();
    let mut total = 0;
    collect(&root, &root, &mut files, &mut total).unwrap();
    assert_eq!(
        files,
        [(
            std::path::PathBuf::from("nested/note.txt"),
            b"content".to_vec()
        )]
    );
    assert_eq!(total, 7);

    fs::remove_dir_all(filesystem_path(&base)).unwrap();
}

fn sample() -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("workbuddy-import-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join(".codebuddy-plugin")).unwrap();
    fs::create_dir_all(root.join("agents")).unwrap();
    fs::create_dir_all(root.join("skills/writer/scripts")).unwrap();
    fs::write(root.join("agents/lead.md"), "---\nname: lead\n---\nLead").unwrap();
    fs::write(
        root.join("agents/member.md"),
        "---\nname: member\n---\nMember",
    )
    .unwrap();
    fs::write(
        root.join("skills/writer/SKILL.md"),
        "---\nname: writer\n---\nWrite",
    )
    .unwrap();
    fs::write(root.join("skills/writer/scripts/run.py"), "print('ok')\n").unwrap();
    fs::write(
        root.join(".codebuddy-plugin/plugin.json"),
        r#"{
      "name":"team-one", "version":"1.0", "expertType":"team", "agentName":"lead",
      "agents":["./agents/lead.md","./agents/member.md"], "skills":["./skills/writer"],
      "teamInfo":{"leadAgent":"lead","memberAgents":["member"]},
      "displayName":{"zh":"团队"}, "members":[
        {"id":"lead","name":{"zh":"主理人"},"role":"lead"},
        {"id":"member","name":{"zh":"成员"},"role":"member"}
      ]
    }"#,
    )
    .unwrap();
    root
}

#[test]
fn parses_team_and_detects_source_changes() {
    let root = sample();
    let first = inspect(root.to_str().unwrap()).unwrap();
    assert_eq!(first.preview.lead, "主理人");
    assert_eq!(first.preview.skills, ["writer"]);
    assert_eq!(first.preview.script_count, 1);
    assert!(first.preview.soul.contains("团队"));
    let profile =
        std::env::temp_dir().join(format!("workbuddy-profile-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(profile.join("skills")).unwrap();
    copy_into_profile(&first, &profile).unwrap();
    let copied = profile.join("skills/imports/workbuddy/team-one/skills/writer/scripts/run.py");
    assert_eq!(fs::read(copied).unwrap(), b"print('ok')\n");
    assert!(profile
        .join("imports/workbuddy/team-one/agents/lead.md")
        .exists());
    assert!(copy_into_profile(&first, &profile).is_err());
    fs::remove_dir_all(profile).unwrap();
    fs::write(
        root.join("skills/writer/scripts/run.py"),
        "print('changed')\n",
    )
    .unwrap();
    let second = inspect(root.to_str().unwrap()).unwrap();
    assert_ne!(first.preview.digest, second.preview.digest);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_traversal_and_invalid_profile_names() {
    assert!(!valid_name("default"));
    assert!(!valid_name("../team"));
    let root = sample();
    let file = root.join(".codebuddy-plugin/plugin.json");
    let raw = fs::read_to_string(&file)
        .unwrap()
        .replace("./agents/lead.md", "../agents/lead.md");
    fs::write(file, raw).unwrap();
    assert!(inspect(root.to_str().unwrap()).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn parses_local_sample_packages_when_supplied() {
    let Ok(root) = std::env::var("WORKBUDDY_SAMPLE_ROOT") else {
        return;
    };
    for (package, agents, skills) in [
        ("gzh-publish-team", 5, 9),
        ("ai-content-creator-team", 7, 1),
    ] {
        let path = std::path::Path::new(&root).join(package);
        let inspected = inspect(path.to_str().unwrap()).unwrap();
        assert_eq!(inspected.preview.package_name, package);
        assert_eq!(inspected.preview.members.len() + 1, agents);
        assert_eq!(inspected.preview.skills.len(), skills);
        assert_eq!(inspected.preview.mcp_count, 0);
        let profile =
            std::env::temp_dir().join(format!("workbuddy-copy-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(profile.join("skills")).unwrap();
        copy_into_profile(&inspected, &profile).unwrap();
        for (relative, bytes) in &inspected.files {
            let target = profile
                .join("imports/workbuddy")
                .join(package)
                .join(relative);
            assert_eq!(&fs::read(target).unwrap(), bytes);
        }
        for skill in &inspected.preview.skills {
            assert!(profile
                .join("skills/imports/workbuddy")
                .join(package)
                .join("skills")
                .join(skill)
                .join("SKILL.md")
                .exists());
        }
        fs::remove_dir_all(profile).unwrap();
    }
}
