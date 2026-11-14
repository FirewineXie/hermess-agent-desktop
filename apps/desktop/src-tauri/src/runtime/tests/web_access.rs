use super::{request, Action};
use crate::{
    process_manager::ProcessManager,
    runtime::{
        self, browser_bridge::BrowserBridgeState, channel_whatsapp::WhatsAppSetupState,
        BackendState,
    },
};
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::Manager;
use uuid::Uuid;

struct Cleanup(Arc<ProcessManager>);

impl Drop for Cleanup {
    fn drop(&mut self) {
        self.0.kill_remaining();
    }
}

async fn wait_for(path: &Path) {
    tokio::time::timeout(Duration::from_secs(30), async {
        while !path.exists() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("browser probe completed");
}

#[tokio::test]
#[ignore = "requires an isolated packaged Gateway and verify-desktop-web-access.py"]
async fn desktop_web_access_live() {
    let hermes = PathBuf::from(std::env::var_os("HERMESS_TEST_GATEWAY_HERMES").unwrap());
    let storage = PathBuf::from(std::env::var_os("HERMESS_TEST_GATEWAY_STORAGE").unwrap());
    let sync = PathBuf::from(std::env::var_os("HERMESS_TEST_GATEWAY_SYNC").unwrap());
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier =
        format!("com.hermess.web-access-test-{}", Uuid::new_v4().simple());
    let app = tauri::Builder::default()
        .any_thread()
        .build(context)
        .unwrap();
    let _cleanup = Cleanup(ProcessManager::init().unwrap());
    app.manage(BackendState::default());
    app.manage(BrowserBridgeState::default());
    app.manage(WhatsAppSetupState::default());
    let state = app.state::<BackendState>();
    let whatsapp = app.state::<WhatsAppSetupState>();
    let run = |action| request(app.handle().clone(), &state, &whatsapp, action);
    let backend = runtime::gateway_recovery::start(
        app.handle().clone(),
        &state,
        hermes.clone(),
        storage.parent().unwrap().to_path_buf(),
        true,
    )
    .await
    .expect("normal private Gateway startup");
    let defaults = run(Action::Status).await.unwrap();
    assert!(!defaults.enabled);
    assert_eq!(defaults.settings.listen_ip, "127.0.0.1");
    let port = std::net::TcpListener::bind(("127.0.0.1", 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let origin = format!("https://127.0.0.1:{port}");
    let saved = run(serde_json::from_value(json!({"action":"save","settings":{
        "origin":origin, "listenIp":"127.0.0.1",
        "certificatePath":sync.join("cert.pem"), "privateKeyPath":sync.join("key.pem")
    }}))
    .unwrap())
    .await
    .unwrap();
    assert!(!saved.enabled);
    assert_eq!(
        Path::new(&saved.settings.certificate_path),
        sync.join("cert.pem")
    );
    let generated = run(serde_json::from_value(json!({"action":"save","settings":{
        "origin":origin, "listenIp":"127.0.0.1",
        "certificatePath":"", "privateKeyPath":""
    }}))
    .unwrap())
    .await
    .unwrap();
    assert!(!generated.enabled);
    assert_ne!(
        saved.settings.certificate_path,
        generated.settings.certificate_path
    );
    assert!(Path::new(&generated.settings.certificate_path).is_file());
    assert!(Path::new(&generated.settings.private_key_path).is_file());
    assert!(tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .is_err());
    let enabled = run(Action::Enable)
        .await
        .expect("enable via production restart path");
    let updated = enabled.restarted.expect("first enablement restarted");
    assert_ne!(updated.pid, backend.pid);
    assert_ne!(updated.port, port);
    assert!(enabled.enabled);
    runtime::ping_backend(app.state())
        .await
        .expect("legacy desktop ping works with Webapp active");
    let profile = state.resolve_profile("default").await.unwrap();
    let (gateway_port, header, credential) = profile.http_auth().await.unwrap();
    let result = runtime::local_http::client()
        .unwrap()
        .get(format!("http://127.0.0.1:{gateway_port}/api/config"))
        .header(header, credential)
        .send()
        .await
        .unwrap();
    assert!(
        result.status().is_success(),
        "existing desktop configuration request"
    );
    let config: serde_json::Value = result.json().await.unwrap();
    assert_eq!(config["webapp"]["host"], "127.0.0.1");
    let link = run(Action::Launch).await.unwrap().link.unwrap();
    fs::write(
        sync.join("ready-0.json"),
        serde_json::json!({
            "origin": origin, "link": link, "gateway_port": updated.port,
            "certificate": generated.settings.certificate_path
        })
        .to_string(),
    )
    .unwrap();
    wait_for(&sync.join("disable")).await;
    assert!(!run(Action::Disable).await.unwrap().enabled);
    runtime::ping_backend(app.state())
        .await
        .expect("disabling Web Access leaves local Gateway connected");
    fs::write(sync.join("disabled"), b"").unwrap();
    runtime::stop_backend(app.state(), app.state(), app.state())
        .await
        .unwrap();
    let backend = runtime::gateway_recovery::start(
        app.handle().clone(),
        &state,
        hermes,
        storage.parent().unwrap().to_path_buf(),
        true,
    )
    .await
    .unwrap();
    let reopened = run(Action::Status).await.unwrap();
    assert!(!reopened.enabled);
    assert_eq!(reopened.settings.origin, origin);
    assert_eq!(
        reopened.settings.certificate_path,
        generated.settings.certificate_path
    );
    let root = runtime::local_http::client()
        .unwrap()
        .get(format!("http://127.0.0.1:{}/", backend.port))
        .send()
        .await
        .unwrap();
    assert_eq!(root.status(), 404);
    runtime::stop_backend(app.state(), app.state(), app.state())
        .await
        .unwrap();
}
