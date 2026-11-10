use super::{install, install_new_profile, SKILLS};
use std::fs;
use uuid::Uuid;

#[test]
fn installs_for_default_and_named_profiles_without_overwriting_user_edits() {
    let storage = std::env::temp_dir().join(format!("hermess-guide-{}", Uuid::new_v4()));
    let home = storage.join("hermes-home");
    let named = home.join("profiles").join("writer");
    fs::create_dir_all(&named).unwrap();
    install(&storage).unwrap();
    for (name, content) in SKILLS {
        let default_skill = home.join("skills").join(name).join("SKILL.md");
        let named_skill = named.join("skills").join(name).join("SKILL.md");
        assert_eq!(fs::read(&default_skill).unwrap(), content);
        assert_eq!(fs::read(&named_skill).unwrap(), content);

        let previous = format!("previous bundled {name}\n");
        fs::write(&named_skill, b"user customization\n").unwrap();
        fs::write(&default_skill, &previous).unwrap();
        fs::write(
            storage.join("control").join(format!("{name}.SKILL.md")),
            previous,
        )
        .unwrap();
    }
    install(&storage).unwrap();
    install_new_profile(&home, "new-agent").unwrap();
    for (name, content) in SKILLS {
        let skill_path = std::path::Path::new("skills").join(name).join("SKILL.md");
        assert_eq!(fs::read(home.join(&skill_path)).unwrap(), content);
        assert_eq!(
            fs::read(named.join(&skill_path)).unwrap(),
            b"user customization\n"
        );
        assert_eq!(
            fs::read(home.join("profiles/new-agent").join(skill_path)).unwrap(),
            content
        );
    }
    assert!(install_new_profile(&home, "../outside").is_err());
    fs::remove_dir_all(storage).unwrap();
}
