use super::*;

struct Fixture {
    _root: tempfile::TempDir,
    file: PathBuf,
    old: PathBuf,
    new: PathBuf,
}

#[test]
fn gateway_must_be_stopped_before_saving_a_different_location() {
    let f = Fixture::new();
    let mut selection = f.load();
    let original = fs::read(&f.file).unwrap();
    let save = || StorageAction::Save {
        path: f.new.to_string_lossy().into_owned(),
    };
    assert_eq!(
        selection.request(save(), true).unwrap_err(),
        "gateway_running"
    );
    assert_eq!(fs::read(&f.file).unwrap(), original);
    assert!(selection.pending.is_none());
    selection.request(StorageAction::Get, true).unwrap();
    selection.request(save(), false).unwrap();
    assert_eq!(selection.pending, Some(f.new));
    assert_eq!(selection.current, f.old);
    // Canceling a pending change does not select a different active directory.
    selection.request(StorageAction::Cancel, true).unwrap();
    assert!(selection.pending.is_none());
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let base = root.path().canonicalize_plain().unwrap();
        let old = base.join("旧 数据");
        let new = base.join("新 数据");
        fs::create_dir_all(old.join("HermessAgentDesktop/hermes-home")).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(
            old.join("HermessAgentDesktop/hermes-home/keep.txt"),
            "original",
        )
        .unwrap();
        let file = base.join("config/location.json");
        super::super::location::write_storage_location(&file, &old).unwrap();
        Self {
            _root: root,
            file,
            old,
            new,
        }
    }
    fn load(&self) -> Selection {
        Selection::load(self.file.clone(), self.old.clone(), true).unwrap()
    }
    fn save(&self, selection: &mut Selection) {
        // Same tagged request shape as the production adapter, accepted by Rust.
        let action =
            serde_json::from_value(json!({"action":"save", "path": self.new.to_string_lossy()}))
                .unwrap();
        selection.run(action).unwrap();
    }
}

#[test]
fn save_is_deferred_and_next_start_uses_new_root_without_migration() {
    let f = Fixture::new();
    let mut running = f.load();
    f.save(&mut running);
    assert_eq!(running.current, f.old);
    assert_eq!(read_storage_location(&f.file).unwrap(), Some(f.old.clone()));
    assert!(!f.new.join("HermessAgentDesktop").exists());
    assert_eq!(
        running.snapshot().pending_path,
        Some(f.new.to_string_lossy().into_owned())
    );
    // An ordinary backend restart does not apply a saved pending location.
    running.run(StorageAction::Retry).unwrap();
    assert_eq!(running.current, f.old);
    let mut next = f.load();
    next.apply().unwrap();
    assert_eq!(next.current, f.new);
    assert!(next.pending.is_none());
    assert_eq!(read_storage_location(&f.file).unwrap(), Some(f.new.clone()));
    assert_eq!(
        fs::read_to_string(f.old.join("HermessAgentDesktop/hermes-home/keep.txt")).unwrap(),
        "original"
    );
    assert!(!f
        .new
        .join("HermessAgentDesktop/hermes-home/keep.txt")
        .exists());
    assert!(f.load().pending.is_none());
}

#[test]
fn existing_data_is_reused_and_switch_back_preserves_both_roots() {
    let f = Fixture::new();
    fs::create_dir_all(f.new.join("HermessAgentDesktop/programming")).unwrap();
    fs::write(
        f.new.join("HermessAgentDesktop/programming/keep.txt"),
        "existing",
    )
    .unwrap();
    let mut selection = f.load();
    f.save(&mut selection);
    selection.apply().unwrap();
    selection
        .run(StorageAction::Save {
            path: f.old.to_string_lossy().into_owned(),
        })
        .unwrap();
    let mut next = f.load();
    next.apply().unwrap();
    assert_eq!(next.current, f.old);
    assert_eq!(
        fs::read_to_string(f.new.join("HermessAgentDesktop/programming/keep.txt")).unwrap(),
        "existing"
    );
}

#[test]
fn missing_pending_root_blocks_without_creating_it_and_can_cancel_or_retry() {
    let f = Fixture::new();
    let mut selection = f.load();
    f.save(&mut selection);
    fs::remove_dir(&f.new).unwrap();
    let mut next = f.load();
    assert_eq!(next.apply().unwrap_err(), "unavailable");
    next.blocked = true;
    assert_eq!(read_storage_location(&f.file).unwrap(), Some(f.old.clone()));
    assert!(!f.new.exists());
    let state = StorageSettingsState(Mutex::new(next));
    assert!(state.selected().is_err());
    let mut next = state.0.lock().unwrap();
    fs::create_dir(&f.new).unwrap();
    next.run(StorageAction::Retry).unwrap();
    assert!(!next.blocked);
    assert_eq!(next.current, f.new);
    drop(next);
    assert_eq!(state.selected().unwrap(), f.new);
    let mut pending = f.load();
    pending
        .run(StorageAction::Save {
            path: f.old.to_string_lossy().into_owned(),
        })
        .unwrap();
    pending.blocked = true;
    pending.run(StorageAction::Cancel).unwrap();
    assert!(!pending.blocked);
    assert_eq!(pending.current, f.new);
    assert!(f.load().pending.is_none());
}

#[test]
fn invalid_requests_and_conflicting_roots_are_rejected_without_changing_config() {
    let f = Fixture::new();
    let mut selection = f.load();
    let original = fs::read(&f.file).unwrap();
    for path in [
        "relative".to_owned(),
        f.old.to_string_lossy().into_owned(),
        f.old
            .join("HermessAgentDesktop")
            .to_string_lossy()
            .into_owned(),
    ] {
        assert!(selection.run(StorageAction::Save { path }).is_err());
        assert_eq!(fs::read(&f.file).unwrap(), original);
    }
    fs::write(f.new.join("HermessAgentDesktop"), "unrelated").unwrap();
    assert!(selection
        .run(StorageAction::Save {
            path: f.new.to_string_lossy().into_owned()
        })
        .is_err());
    assert_eq!(fs::read(&f.file).unwrap(), original);
    assert!(
        serde_json::from_value::<StorageAction>(json!({"action":"migrate","path":"anything"}))
            .is_err()
    );
    assert!(serde_json::from_value::<StorageAction>(json!({"action":"save"})).is_err());
    assert!(serde_json::from_value::<StorageAction>(
        json!({"action":"save","path":"x","migrate":true})
    )
    .is_err());
}

#[test]
fn occupied_target_is_rejected_on_save_and_on_next_start() {
    let f = Fixture::new();
    fs::create_dir_all(f.new.join("HermessAgentDesktop/control")).unwrap();
    let mut selection = f.load();
    let held = acquire_storage_lock(&f.new.join("HermessAgentDesktop")).unwrap();
    assert_eq!(
        selection
            .run(StorageAction::Save {
                path: f.new.to_string_lossy().into_owned()
            })
            .unwrap_err(),
        "in_use"
    );
    drop(held);
    f.save(&mut selection);
    let held = acquire_storage_lock(&f.new.join("HermessAgentDesktop")).unwrap();
    let mut next = f.load();
    assert_eq!(next.apply().unwrap_err(), "in_use");
    assert_eq!(read_storage_location(&f.file).unwrap(), Some(f.old));
    drop(held);
    next.apply().unwrap();
}

#[test]
fn failed_save_preserves_the_previous_selection() {
    let f = Fixture::new();
    let mut selection = f.load();
    selection.file = f.new.join("not-a-directory/location.json");
    fs::write(f.new.join("not-a-directory"), "file").unwrap();
    assert_eq!(
        selection
            .run(StorageAction::Save {
                path: f.new.to_string_lossy().into_owned()
            })
            .unwrap_err(),
        "save_failed"
    );
    assert_eq!(selection.current, f.old);
    assert!(selection.pending.is_none());
}

#[cfg(unix)]
#[test]
fn symbolic_links_are_rejected() {
    let f = Fixture::new();
    let link = f.new.join("link");
    std::os::unix::fs::symlink(&f.old, &link).unwrap();
    assert_eq!(validate(&link).unwrap_err(), "invalid_path");
}

#[test]
fn ordinary_nonempty_parent_is_allowed_but_unknown_product_data_is_rejected() {
    let f = Fixture::new();
    fs::write(f.new.join("unrelated.txt"), "untouched").unwrap();
    assert_eq!(validate(&f.new).unwrap(), f.new);
    fs::create_dir(f.new.join("HermessAgentDesktop")).unwrap();
    fs::write(f.new.join("HermessAgentDesktop/foreign.txt"), "foreign").unwrap();
    assert_eq!(validate(&f.new).unwrap_err(), "invalid_data");
    assert_eq!(
        fs::read_to_string(f.new.join("unrelated.txt")).unwrap(),
        "untouched"
    );
    assert_eq!(
        fs::read_to_string(f.new.join("HermessAgentDesktop/foreign.txt")).unwrap(),
        "foreign"
    );
    fs::remove_file(f.new.join("HermessAgentDesktop/foreign.txt")).unwrap();
    fs::create_dir(f.new.join("HermessAgentDesktop/logs")).unwrap();
    assert_eq!(validate(&f.new).unwrap(), f.new);
}

#[test]
fn failed_activation_commit_preserves_old_location_and_pending_change() {
    let f = Fixture::new();
    let mut selection = f.load();
    f.save(&mut selection);
    let config = fs::read(&f.file).unwrap();
    // A directory cannot be atomically replaced by a location file.
    selection.file = f.new.clone();
    assert_eq!(selection.apply().unwrap_err(), "save_failed");
    assert_eq!(selection.current, f.old);
    assert_eq!(selection.pending, Some(f.new));
    assert_eq!(fs::read(&f.file).unwrap(), config);
}

#[test]
fn development_selection_cannot_write_release_preferences() {
    let f = Fixture::new();
    let mut selection = f.load();
    selection.enabled = false;
    let config = fs::read(&f.file).unwrap();
    assert_eq!(
        selection
            .run(StorageAction::Save {
                path: f.new.to_string_lossy().into_owned()
            })
            .unwrap_err(),
        "development"
    );
    assert_eq!(fs::read(&f.file).unwrap(), config);
}
