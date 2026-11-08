use super::*;

struct TestDirectory(std::path::PathBuf);
impl TestDirectory {
    fn new() -> Self {
        let path = crate::paths::plain_path(&std::env::temp_dir())
            .join(format!("hermess-permissions-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn draft(
    settings: &PermissionSettings,
    profile: &str,
    policy: &str,
    reviewer: &str,
) -> PermissionDraft {
    PermissionDraft {
        revision: settings.draft.revision.clone(),
        default_permissions: profile.into(),
        approval_policy: policy.into(),
        approvals_reviewer: reviewer.into(),
        network_access: None,
        writable_roots: vec![],
    }
}

#[test]
fn saves_permissions_without_overwriting_other_configuration_and_rejects_stale_or_invalid_input() {
    let directory = TestDirectory::new();
    let path = directory.path().join("config.toml");
    let original = "# preserve comment\nmodel_reasoning_effort = 'high'\n[permissions.inspect]\nextends = ':read-only'\n[auto_review]\ntimeout_ms = 30000\n";
    fs::write(&path, original).unwrap();
    let current = parse(original).unwrap();
    assert!(current.profiles.contains(&"inspect".into()));
    let saved = save_at(
        &path,
        draft(&current, "inspect", "on-request", "auto_review"),
    )
    .unwrap();
    assert_eq!(saved.draft.default_permissions, "inspect");
    let updated = text(&path).unwrap();
    assert!(updated.contains("# preserve comment"));
    let table: toml::Table = toml::from_str(&updated).unwrap();
    assert_eq!(table["model_reasoning_effort"].as_str(), Some("high"));
    assert_eq!(
        table["permissions"]["inspect"]["extends"].as_str(),
        Some(":read-only")
    );
    assert_eq!(table["auto_review"]["timeout_ms"].as_integer(), Some(30000));
    for bad in [
        draft(&current, "hermess", "never", "user"),
        draft(&saved, "missing", "never", "user"),
        draft(&saved, "hermess", "invalid", "user"),
        draft(&saved, "hermess", "untrusted", "user"),
        draft(&saved, "hermess", "on-failure", "user"),
        draft(&saved, "hermess", "never", "invalid"),
    ] {
        assert!(save_at(&path, bad).is_err());
        assert_eq!(text(&path).unwrap(), updated);
    }
    fs::write(&path, "not valid TOML [").unwrap();
    assert!(save_at(&path, draft(&saved, "hermess", "never", "user")).is_err());
    assert_eq!(text(&path).unwrap(), "not valid TOML [");
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "uses isolated windowless Windows Tauri directories"]
async fn native_permission_settings_command_roundtrip() {
    use crate::runtime::coding::{coding_session_request, CodingRequest, CodingState};
    use serde_json::json;
    use tauri::Manager;
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = &isolated.app;
    app.manage(CodingState::default());
    let read: CodingRequest =
        serde_json::from_value(json!({"action":"permission_settings"})).unwrap();
    let current = coding_session_request(app.handle().clone(), app.state(), read)
        .await
        .unwrap();
    assert_eq!(current["default_permissions"], "hermess");
    let draft = json!({"revision":current["revision"], "default_permissions":"hermess-readonly",
        "approval_policy":"on-request", "approvals_reviewer":"auto_review"});
    let request: CodingRequest =
        serde_json::from_value(json!({"action":"save_permission_settings", "draft":draft}))
            .unwrap();
    let saved = coding_session_request(app.handle().clone(), app.state(), request)
        .await
        .unwrap();
    assert_eq!(saved["default_permissions"], "hermess-readonly");
    assert_ne!(saved["revision"], current["revision"]);
    let file = coding_config::owned(app.handle(), Path::new("config.toml")).unwrap();
    let original = text(&file).unwrap();
    let stale: CodingRequest =
        serde_json::from_value(json!({"action":"save_permission_settings", "draft":draft}))
            .unwrap();
    let failure = coding_session_request(app.handle().clone(), app.state(), stale)
        .await
        .unwrap_err();
    assert_eq!(serde_json::to_value(failure).unwrap()["code"], "conflict");
    let invalid: CodingRequest = serde_json::from_value(json!({"action":"save_permission_settings", "draft":{
        "revision":saved["revision"], "default_permissions":"not-a-profile", "approval_policy":"never", "approvals_reviewer":"user"
    }})).unwrap();
    let failure = coding_session_request(app.handle().clone(), app.state(), invalid)
        .await
        .unwrap_err();
    assert_eq!(
        serde_json::to_value(failure).unwrap()["code"],
        "invalid_input"
    );
    assert_eq!(text(&file).unwrap(), original);
    assert!(serde_json::from_value::<CodingRequest>(json!({"action":"save_permission_settings", "draft":{
        "revision":"", "default_permissions":"hermess", "approval_policy":"never", "approvals_reviewer":"user", "api_key":"UNEXPECTED_FIXTURE"
    }})).is_err());
}

#[test]
fn reads_legacy_values_with_the_same_defaults_as_the_worker() {
    assert_eq!(parse("").unwrap().draft.default_permissions, "hermess");
    for (legacy, expected) in [
        ("read-only", ":read-only"),
        ("workspace-write", ":workspace"),
        ("danger-full-access", ":danger-full-access"),
    ] {
        let settings = parse(&format!(
            "sandbox_mode = '{legacy}'\napprovals_reviewer = 'guardian_subagent'\n"
        ))
        .unwrap();
        assert_eq!(settings.draft.default_permissions, expected);
        assert_eq!(settings.draft.approvals_reviewer, "auto_review");
    }
    for legacy in ["on-failure", "untrusted"] {
        assert_eq!(
            parse(&format!("approval_policy = '{legacy}'"))
                .unwrap()
                .draft
                .approval_policy,
            legacy
        );
    }
    for invalid in [
        "default_permissions = 'unknown'",
        "approval_policy = 7",
        "permissions = []",
    ] {
        assert!(parse(invalid).is_err());
    }
}

#[test]
fn network_and_writable_roots_are_saved_as_real_named_profile_rules() {
    let directory = TestDirectory::new();
    let path = directory.path().join("config.toml");
    let extra = directory.path().join("extra");
    fs::create_dir_all(&extra).unwrap();
    let original = "# preserve\n[permissions.hermess.filesystem]\n'/protected-fixture' = 'deny'\n";
    fs::write(&path, original).unwrap();
    let current = parse(original).unwrap();
    let mut update = draft(&current, "hermess", "on-request", "user");
    update.network_access = Some(true);
    update.writable_roots = vec![extra.to_string_lossy().into_owned()];
    let saved = save_at(&path, update).unwrap();
    assert_eq!(saved.draft.network_access, Some(true));
    assert_eq!(saved.draft.writable_roots.len(), 1);
    assert!(text(&path).unwrap().contains("# preserve"));
    let mut update = draft(&saved, ":workspace", "on-request", "user");
    update.network_access = Some(false);
    let saved = save_at(&path, update).unwrap();
    assert_eq!(
        saved.draft.default_permissions,
        "hermess-settings-workspace"
    );
    assert_eq!(saved.draft.network_access, Some(false));
}

#[test]
fn permission_form_runtime_fixtures_use_production_save() {
    let directory = TestDirectory::new();
    let export = std::env::var_os("HERMESS_PERMISSION_FIXTURES").map(std::path::PathBuf::from);
    if let Some(export) = &export {
        fs::create_dir_all(export).unwrap();
    }
    for (index, profile) in [
        "hermess",
        "hermess-readonly",
        ":danger-full-access",
        ":workspace",
        ":read-only",
        "inspect",
    ]
    .into_iter()
    .enumerate()
    {
        for policy in POLICIES {
            for reviewer in ["user", "auto_review"] {
                let path = directory.path().join("config.toml");
                fs::write(&path, "[permissions.inspect]\nextends = ':read-only'\n").unwrap();
                let before = parse(&text(&path).unwrap()).unwrap();
                let result = save_at(&path, draft(&before, profile, policy, reviewer)).unwrap();
                assert_eq!(
                    parse(&text(&path).unwrap()).unwrap().draft.revision,
                    result.draft.revision
                );
                if let Some(export) = &export {
                    fs::copy(
                        &path,
                        export.join(format!("{index}-{policy}-{reviewer}.toml")),
                    )
                    .unwrap();
                }
            }
        }
    }
}

#[cfg(windows)]
#[test]
fn locked_permission_file_keeps_original_and_can_retry() {
    use std::os::windows::fs::OpenOptionsExt;
    let directory = TestDirectory::new();
    let path = directory.path().join("config.toml");
    fs::write(&path, "# original\n").unwrap();
    let current = parse(&text(&path).unwrap()).unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .unwrap();
    assert!(save_at(&path, draft(&current, "hermess-readonly", "never", "user")).is_err());
    assert_eq!(text(&path).unwrap(), "# original\n");
    drop(lock);
    assert!(save_at(&path, draft(&current, "hermess-readonly", "never", "user")).is_ok());
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}
