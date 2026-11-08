use super::*;
use crate::runtime::{
    coding::{coding_session_request, CodingRequest, CodingState},
    coding_providers::{coding_provider_request, ProviderRequest},
};
use tauri::Manager;

fn draft(id: Option<String>, url: &str, models: &[&str]) -> ProviderDraft {
    ProviderDraft {
        id,
        name: "Fixture provider".into(),
        region: "domestic".into(),
        base_url: url.into(),
        api_key: None,
        models: models.iter().map(|name| name.to_string()).collect(),
    }
}

#[tokio::test]
async fn catalog_routes_models_migrates_legacy_and_never_revives_removed_connection() {
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = isolated.app.handle();
    app.manage(CodingState::default());
    let legacy = coding_config::save(
        app,
        coding_config::CodingConfigDraft {
            enabled: true,
            base_url: "https://fixture.invalid/v1".into(),
            model: "legacy".into(),
            effort: "medium".into(),
            api_key: Some("LEGACY_FIXTURE".into()),
        },
    )
    .await
    .unwrap();
    let first = read(app).unwrap();
    assert_eq!(first.default_model, legacy.id);
    let old_id = first.providers[0].id.clone();
    let next = apply(
        app,
        load(app).unwrap(),
        draft(
            Some(old_id.clone()),
            "https://fixture.invalid/v1",
            &["legacy", "second"],
        ),
        "ROTATED_FIXTURE".into(),
    )
    .unwrap();
    assert_eq!(next.providers[0].models[0].id, legacy.id);
    assert!(!coding_config::root(app)
        .unwrap()
        .join("connection.enc")
        .exists());
    let second = next.providers[0].models[1].id.clone();
    let (selected_route, key) = route(app, Some(&second)).unwrap();
    assert_eq!(selected_route.model, "second");
    assert_eq!(key, "ROTATED_FIXTURE");
    let next = apply(
        app,
        load(app).unwrap(),
        draft(None, "https://other.invalid/v1", &["third"]),
        "OTHER_FIXTURE".into(),
    )
    .unwrap();
    assert_eq!(next.providers.len(), 2);
    let public = serde_json::to_string(&next).unwrap();
    assert!(!public.contains("ROTATED_FIXTURE"));
    assert!(!public.contains("OTHER_FIXTURE"));
    let encrypted = fs::read(coding_config::root(app).unwrap().join("connections.enc")).unwrap();
    assert!(!String::from_utf8_lossy(&encrypted).contains("OTHER_FIXTURE"));
    let cwd = crate::paths::plain_path(&std::env::temp_dir())
        .to_string_lossy()
        .into_owned();
    let request: CodingRequest =
        serde_json::from_value(serde_json::json!({"action":"create","cwd":cwd,"model_id":second}))
            .unwrap();
    let chat = coding_session_request(app.clone(), app.state(), request)
        .await
        .unwrap();
    assert_eq!(chat["model"], "second");
    assert_eq!(chat["config_id"], second);
    let changed = apply(
        app,
        load(app).unwrap(),
        draft(
            Some(old_id.clone()),
            "https://changed.invalid/v1",
            &["legacy", "second"],
        ),
        "ROTATED_FIXTURE".into(),
    )
    .unwrap();
    assert_ne!(changed.providers[0].models[1].id, second);
    assert!(route(app, Some(&second)).is_err());
    for id in changed
        .providers
        .iter()
        .map(|p| p.id.clone())
        .collect::<Vec<_>>()
    {
        let request: ProviderRequest =
            serde_json::from_value(serde_json::json!({"action":"remove","id":id})).unwrap();
        coding_provider_request(app.clone(), app.state(), request)
            .await
            .unwrap();
    }
    let empty = read(app).unwrap();
    assert!(empty.providers.is_empty());
    assert!(!empty.enabled);
    assert!(coding_config::read(app).unwrap().model.is_empty());
    assert!(coding_config::save(
        app,
        coding_config::CodingConfigDraft {
            enabled: true,
            base_url: "https://fixture.invalid/v1".into(),
            model: "legacy".into(),
            effort: "medium".into(),
            api_key: Some("LEGACY_FIXTURE".into())
        }
    )
    .await
    .is_err());
}

#[tokio::test]
async fn failed_validation_does_not_replace_encrypted_catalog() {
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = isolated.app.handle();
    app.manage(CodingState::default());
    let saved = apply(
        app,
        load(app).unwrap(),
        draft(None, "https://fixture.invalid/v1", &["old"]),
        "OLD_FIXTURE".into(),
    )
    .unwrap();
    let path = coding_config::root(app).unwrap().join("connections.enc");
    let before = fs::read(&path).unwrap();
    let mut edited = draft(
        Some(saved.providers[0].id.clone()),
        "http://127.0.0.1:1/v1",
        &["new"],
    );
    edited.api_key = Some("NEW_FIXTURE".into());
    let result = coding_provider_request(
        app.clone(),
        app.state(),
        ProviderRequest::Save { draft: edited },
    )
    .await
    .unwrap();
    assert!(result.error.is_some());
    assert!(result.catalog.is_none());
    assert_eq!(fs::read(path).unwrap(), before);
    assert_eq!(read(app).unwrap().revision, saved.revision);
}

#[tokio::test]
async fn native_save_validates_before_publishing_sanitized_catalog() {
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = isolated.app.handle();
    app.manage(CodingState::default());
    let (url, server) = crate::runtime::coding_validation::tests::fixture(200, "valid");
    let request:ProviderRequest=serde_json::from_value(serde_json::json!({"action":"save","draft":{"name":"Validated fixture","region":"overseas","base_url":url,"api_key":"fixture-key","models":["fixture-model"]}})).unwrap();
    let result = coding_provider_request(app.clone(), app.state(), request)
        .await
        .unwrap();
    server.join().unwrap();
    assert!(result.error.is_none());
    let saved = result.catalog.unwrap();
    assert_eq!(saved.providers[0].models[0].name, "fixture-model");
    assert!(!serde_json::to_string(&saved)
        .unwrap()
        .contains("fixture-key"));
    assert_eq!(
        route(app, Some(&saved.default_model)).unwrap().1,
        "fixture-key"
    );
}
