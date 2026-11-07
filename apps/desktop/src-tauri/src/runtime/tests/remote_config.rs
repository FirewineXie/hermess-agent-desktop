use super::{config_path, delete, read, save, RemoteGatewayConfig, KEYRING_SERVICE};
use crate::paths::{filesystem_path, plain_path};
use std::{fs, os::windows::fs::OpenOptionsExt, path::PathBuf};
use tauri::Manager;
use uuid::Uuid;

pub(in crate::runtime) struct IsolatedRemoteConfig {
    pub(in crate::runtime) app: tauri::App,
    identifier: String,
    roots: Vec<PathBuf>,
    credentials: Vec<String>,
}

impl IsolatedRemoteConfig {
    pub(in crate::runtime) fn new() -> Self {
        let identifier = format!("com.hermess.remote-delete-test-{}", Uuid::new_v4().simple());
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context.config_mut().identifier = identifier.clone();
        let app = tauri::Builder::default()
            .any_thread()
            .build(context)
            .expect("isolated windowless Tauri app");
        app.manage(crate::runtime::BackendState::default());
        let mut roots = vec![
            plain_path(&app.path().app_config_dir().unwrap()),
            plain_path(&app.path().app_data_dir().unwrap()),
            plain_path(&app.path().app_local_data_dir().unwrap()),
        ];
        roots.sort();
        roots.dedup();
        for root in &roots {
            assert!(root.is_absolute());
            assert_eq!(
                root.file_name().unwrap().to_str(),
                Some(identifier.as_str())
            );
        }
        Self {
            app,
            identifier,
            roots,
            credentials: Vec::new(),
        }
    }

    pub(in crate::runtime) async fn save(&mut self, label: &str) -> RemoteGatewayConfig {
        let config = save(
            self.app.handle(),
            label.to_owned(),
            "http://127.0.0.1:19120".to_owned(),
            "isolated-delete-test-token".to_owned(),
        )
        .await
        .expect("save isolated remote config using production storage");
        self.credentials.push(config.id.clone());
        config
    }

    pub(in crate::runtime) fn entry(&self, id: &str) -> keyring::Entry {
        assert!(self.credentials.iter().any(|owned| owned == id));
        keyring::Entry::new(KEYRING_SERVICE, id).unwrap()
    }
}

impl Drop for IsolatedRemoteConfig {
    fn drop(&mut self) {
        for id in &self.credentials {
            if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, id) {
                let _ = entry.delete_credential();
            }
        }
        for root in &self.roots {
            if root.is_absolute()
                && root.file_name().and_then(|name| name.to_str()) == Some(self.identifier.as_str())
            {
                let _ = fs::remove_dir_all(filesystem_path(root));
            }
        }
    }
}

#[tokio::test]
#[ignore = "uses isolated Windows Tauri directories and random native credential entries"]
async fn remote_config_delete_storage_live() {
    let mut fixture = IsolatedRemoteConfig::new();
    let missing_credential = fixture.save("missing credential").await;
    fixture
        .entry(&missing_credential.id)
        .delete_credential()
        .unwrap();
    delete(fixture.app.handle(), &missing_credential.id, Uuid::new_v4())
        .await
        .expect("missing credential is already cleaned up");
    assert!(read(fixture.app.handle()).unwrap().is_none());

    let locked = fixture.save("retry file cleanup").await;
    let path = config_path(fixture.app.handle()).unwrap();
    // Allow the production read but deny deletion until this test releases the
    // handle, reproducing a Windows sharing violation without changing ACLs.
    let file = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(filesystem_path(&path))
        .unwrap();
    let failure = delete(fixture.app.handle(), &locked.id, Uuid::new_v4())
        .await
        .expect_err("locked config file must report failure");
    assert_eq!(
        serde_json::to_value(failure).unwrap()["code"],
        "operation_failed"
    );
    assert_eq!(read(fixture.app.handle()).unwrap().unwrap().id, locked.id);
    assert!(matches!(
        fixture.entry(&locked.id).get_password(),
        Err(keyring::Error::NoEntry)
    ));
    drop(file);
    delete(fixture.app.handle(), &locked.id, Uuid::new_v4())
        .await
        .expect("retry completes after file lock is released");
    assert!(read(fixture.app.handle()).unwrap().is_none());
}
