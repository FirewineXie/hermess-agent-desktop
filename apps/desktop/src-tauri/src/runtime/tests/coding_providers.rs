use super::{run_profile_helper, Imported, ProfileProvider, ProviderRequest};
use serde_json::json;
use std::{fs, path::Path};

#[cfg(windows)]
#[tokio::test]
#[ignore = "runs the product Profile helper with the locked local Hermes Python"]
async fn native_profile_helper_reads_selected_provider_and_all_saved_models() {
    crate::process_manager::ProcessManager::init().unwrap();
    let isolated = crate::runtime::remote_config::tests::IsolatedRemoteConfig::new();
    let app = isolated.app.handle();
    let root = super::coding_config::root(app)
        .unwrap()
        .join("fixture-profile");
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("config.yaml"),
        r#"model:
  provider: custom:main
  default: main-model
providers:
  main:
    base_url: https://main.invalid/v1
    default_model: main-model
    api_key: MAIN_FIXTURE_ONLY
  selected:
    name: Selected fixture
    base_url: https://selected.invalid/v1
    default_model: selected-one
    key_env: SELECTED_KEY
    models:
      selected-one: {}
"#,
    )
    .unwrap();
    fs::write(root.join(".env"), "SELECTED_KEY=SELECTED_FIXTURE_ONLY\n").unwrap();
    let models = root.join("model-candidates.json");
    fs::write(
        &models,
        json!({"selected":["selected-one","selected-two"]}).to_string(),
    )
    .unwrap();
    let hermes = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.build/hermes-venv-i1/Scripts/hermes.exe");
    let list = run_profile_helper(app, &hermes, &root, &models, None)
        .await
        .unwrap();
    assert!(!list.to_string().contains("FIXTURE_ONLY"));
    let choices: Vec<ProfileProvider> = serde_json::from_value(list).unwrap();
    let selected = choices
        .iter()
        .find(|value| value.id == "custom:selected")
        .unwrap();
    assert_eq!(selected.models, vec!["selected-one", "selected-two"]);
    let request: ProviderRequest = serde_json::from_value(
        json!({"action":"sync_profile","profile":"fixture","provider":selected.id}),
    )
    .unwrap();
    let ProviderRequest::SyncProfile { provider, .. } = request else {
        panic!("wrong request")
    };
    let imported: Imported = serde_json::from_value(
        run_profile_helper(app, &hermes, &root, &models, Some(&provider))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(imported.api_key, "SELECTED_FIXTURE_ONLY");
    assert_eq!(imported.base_url, "https://selected.invalid/v1");
    assert_eq!(imported.name, "Selected fixture");
    assert_eq!(imported.models, vec!["selected-one", "selected-two"]);
    assert!(
        run_profile_helper(app, &hermes, &root, &models, Some("custom:unknown"))
            .await
            .is_err()
    );
}
