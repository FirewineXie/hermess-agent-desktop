use super::{install, install_new_profile, CONTENT, SKILL_NAME};
use std::fs;
use uuid::Uuid;

#[test]
fn installs_for_default_and_named_profiles_without_overwriting_user_edits() {
    let storage = std::env::temp_dir().join(format!("hermess-guide-{}", Uuid::new_v4()));
    let home = storage.join("hermes-home");
    let named = home.join("profiles").join("writer");
    fs::create_dir_all(&named).unwrap();
    install(&storage).unwrap();
    let default_skill = home.join("skills").join(SKILL_NAME).join("SKILL.md");
    let named_skill = named.join("skills").join(SKILL_NAME).join("SKILL.md");
    assert_eq!(fs::read(&default_skill).unwrap(), CONTENT);
    assert_eq!(fs::read(&named_skill).unwrap(), CONTENT);

    fs::write(&named_skill, b"user customization\n").unwrap();
    fs::write(&default_skill, b"previous bundled version\n").unwrap();
    fs::write(
        storage.join("control/hermess-desktop-guide.SKILL.md"),
        b"previous bundled version\n",
    )
    .unwrap();
    install(&storage).unwrap();
    assert_eq!(fs::read(&default_skill).unwrap(), CONTENT);
    assert_eq!(fs::read(&named_skill).unwrap(), b"user customization\n");

    install_new_profile(&home, "new-agent").unwrap();
    assert_eq!(
        fs::read(
            home.join("profiles/new-agent/skills")
                .join(SKILL_NAME)
                .join("SKILL.md")
        )
        .unwrap(),
        CONTENT
    );
    assert!(install_new_profile(&home, "../outside").is_err());
    fs::remove_dir_all(storage).unwrap();
}
