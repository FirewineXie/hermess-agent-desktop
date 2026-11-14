use super::{valid_source, MediaResources};

fn entry(window: &str) -> super::MediaEntry {
    super::MediaEntry {
        resource: super::MediaResource {
            id: uuid::Uuid::new_v4().to_string(),
            name: "test.png".into(),
            kind: "image".into(),
            mime: "image/png".into(),
            size: Some(3),
            local: false,
        },
        owner: super::MediaOwner {
            scope: super::MediaScope {
                profile: "default".into(),
                session_id: "session-a".into(),
                gateway_epoch: "epoch-a".into(),
            },
            client: crate::gateway::media_test_support::idle_gateway("epoch-a"),
            remote: true,
            base_url: "http://127.0.0.1".into(),
        },
        window: window.into(),
        source: super::MediaSource::Data(std::sync::Arc::new(vec![1, 2, 3])),
        released: std::sync::atomic::AtomicBool::new(false),
        cancel: tokio::sync::Notify::new(),
    }
}

#[test]
fn unknown_resources_cannot_be_resolved_by_any_window() {
    let resources = MediaResources::default();
    assert!(resources
        .get(&uuid::Uuid::new_v4().to_string(), "main")
        .is_err());
    assert!(resources.get("../config.yaml", "main").is_err());
    assert!(!valid_source("C:\\path\nforged.png"));
    assert!(!valid_source(""));
}

#[tokio::test]
async fn registered_media_is_window_bound_and_release_cancels_waiters() {
    let resources = MediaResources::default();
    let resource = resources.insert(entry("chat-a")).unwrap();
    assert!(resources.get(&resource.id, "chat-b").is_err());
    assert!(resources.release(&resource.id, "chat-b").is_err());
    let retained = resources.get(&resource.id, "chat-a").unwrap();
    resources.release(&resource.id, "chat-a").unwrap();
    assert!(resources.get(&resource.id, "chat-a").is_err());
    tokio::time::timeout(std::time::Duration::from_millis(100), retained.cancelled())
        .await
        .unwrap();
    assert!(retained
        .ensure_current(&super::BackendState::default())
        .await
        .is_err());
}

#[tokio::test]
async fn media_owner_rejects_replaced_connection_and_epoch() {
    use crate::runtime::{remote_config::RemoteGatewayConfig, remote_gateway::ActiveRemote};
    let state = super::BackendState::default();
    let mut entry = entry("main");
    *state.5.lock().await = Some(ActiveRemote {
        config: RemoteGatewayConfig {
            id: "test".into(),
            label: "test".into(),
            url: "http://127.0.0.1".into(),
            ssh_target: None,
        },
        gateway: std::sync::Arc::clone(&entry.owner.client),
        selected_profile: "different-profile".into(),
        session_owners: std::sync::Arc::default(),
        storage: std::env::temp_dir(),
    });
    assert!(entry.ensure_current(&state).await.is_ok());
    // An epoch match does not permit a different physical connection.
    state.5.lock().await.as_mut().unwrap().gateway =
        crate::gateway::media_test_support::idle_gateway("epoch-a");
    assert!(entry.ensure_current(&state).await.is_err());
    state.5.lock().await.as_mut().unwrap().gateway = std::sync::Arc::clone(&entry.owner.client);
    assert!(entry.ensure_current(&state).await.is_ok());
    // Conversely, pointer identity cannot override a stale epoch in the scope.
    entry.owner.scope.gateway_epoch = "epoch-b".into();
    assert!(entry.ensure_current(&state).await.is_err());
}
