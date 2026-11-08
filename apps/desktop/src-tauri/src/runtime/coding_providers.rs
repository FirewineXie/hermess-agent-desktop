use super::{
    coding::CodingState,
    coding_catalog::{self, CodingCatalog, ProviderDraft},
    coding_config,
    coding_validation::{self, ValidationStage},
    helper_python, BackendState,
};
use crate::{errors::DesktopFailure, paths::plain_path, process_manager};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, process::Stdio, time::Duration};
use tauri::{AppHandle, Manager, State};

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ProviderRequest {
    List,
    Save { draft: ProviderDraft },
    ProfileProviders { profile: String },
    SyncProfile { profile: String, provider: String },
    Remove { id: String },
    Preferences { enabled: bool, effort: String },
}
#[derive(Clone, Deserialize, Serialize)]
pub struct ProfileProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub models: Vec<String>,
}
#[derive(Serialize)]
pub struct ProviderResult {
    pub catalog: Option<CodingCatalog>,
    pub error: Option<ValidationStage>,
    pub profile_providers: Option<Vec<ProfileProvider>>,
}
impl ProviderResult {
    fn saved(catalog: CodingCatalog) -> Self {
        Self {
            catalog: Some(catalog),
            error: None,
            profile_providers: None,
        }
    }
    fn rejected(error: ValidationStage) -> Self {
        Self {
            catalog: None,
            error: Some(error),
            profile_providers: None,
        }
    }
}
async fn ensure_idle(state: &CodingState) -> Result<(), DesktopFailure> {
    if state
        .live
        .lock()
        .await
        .values()
        .any(|live| !live.control.is_closed())
    {
        return Err(DesktopFailure::conflict());
    }
    Ok(())
}
#[derive(Deserialize)]
struct Imported {
    base_url: String,
    api_key: String,
    name: String,
    models: Vec<String>,
}
async fn profile_data(
    app: &AppHandle,
    profile: &str,
    provider: Option<&str>,
) -> Result<serde_json::Value, DesktopFailure> {
    let state = app.state::<BackendState>();
    let scope = state.resolve_profile(profile).await?;
    scope.ensure_current(&state).await?;
    let models_file = if profile == "default" {
        scope.storage.join("model-candidates.json")
    } else {
        scope.home.join("model-candidates.json")
    };
    let result = run_profile_helper(app, &scope.hermes, &scope.home, &models_file, provider).await;
    scope.ensure_current(&state).await?;
    result
}
async fn run_profile_helper(
    app: &AppHandle,
    hermes: &Path,
    home: &Path,
    models_file: &Path,
    provider: Option<&str>,
) -> Result<serde_json::Value, DesktopFailure> {
    let root = coding_config::root(app)?;
    super::coding_vault::private_directory(&root)?;
    let isolated = coding_config::owned(app, Path::new("profile-sync"))?;
    super::coding_vault::private_directory(&isolated)?;
    let mut command = helper_python::command(
        hermes,
        include_str!("../../../runtime/programming_profile.py"),
    )?;
    let python_path = command
        .as_std()
        .get_envs()
        .find(|(key, _)| *key == "PYTHONPATH")
        .and_then(|(_, value)| value.map(|value| value.to_owned()));
    command.env_clear();
    for name in [
        "PATH",
        "SystemRoot",
        "SystemDrive",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
        "HOME",
        "USERPROFILE",
        "LANG",
        "LC_ALL",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    if let Some(path) = python_path {
        command.env("PYTHONPATH", path);
    } else if cfg!(debug_assertions) {
        command.env(
            "PYTHONPATH",
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../upstream/hermes-agent"),
        );
    }
    command.env(
        "HERMESS_PROFILE_IMPORT_REQUEST",
        serde_json::json!({"provider":provider,"models_file":plain_path(&models_file)}).to_string(),
    );
    command
        .env("HERMES_HOME", plain_path(home))
        .env("CODEX_HOME", &isolated)
        .env("CODEX_SQLITE_HOME", &isolated)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        process_manager::output(&mut command, "coding_profile_sync"),
    )
    .await
    .map_err(|_| DesktopFailure::timeout())?
    .map_err(|_| DesktopFailure::operation_failed())?;
    if !output.status.success() || output.stdout.len() > 1024 * 1024 {
        return Err(DesktopFailure::invalid_input());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| DesktopFailure::operation_failed())
}

#[tauri::command]
pub async fn coding_provider_request(
    app: AppHandle,
    state: State<'_, CodingState>,
    request: ProviderRequest,
) -> Result<ProviderResult, DesktopFailure> {
    if let ProviderRequest::ProfileProviders { profile } = &request {
        let operation = uuid::Uuid::new_v4();
        coding_config::log(
            &app,
            &format!("programming_profile_providers_start operation={operation}"),
        );
        let result = profile_data(&app, profile, None).await;
        coding_config::log(
            &app,
            &format!(
                "{}programming_profile_providers_result operation={operation} success={}",
                if result.is_err() { "ERROR " } else { "" },
                result.is_ok()
            ),
        );
        let value = result?;
        let providers =
            serde_json::from_value(value).map_err(|_| DesktopFailure::operation_failed())?;
        return Ok(ProviderResult {
            catalog: None,
            error: None,
            profile_providers: Some(providers),
        });
    }
    if matches!(&request, ProviderRequest::List) {
        return coding_catalog::read(&app).map(ProviderResult::saved);
    }
    let operation = uuid::Uuid::new_v4();
    coding_config::log(
        &app,
        &format!("programming_provider_start operation={operation}"),
    );
    let result = execute(&app, &state, request, operation).await;
    coding_config::log(
        &app,
        &format!(
            "{}programming_provider_result operation={operation} success={}",
            if matches!(&result,Ok(value) if value.error.is_none()) {
                ""
            } else {
                "ERROR "
            },
            matches!(&result,Ok(value) if value.error.is_none())
        ),
    );
    result
}
async fn execute(
    app: &AppHandle,
    state: &CodingState,
    request: ProviderRequest,
    operation: uuid::Uuid,
) -> Result<ProviderResult, DesktopFailure> {
    let (snapshot, mut draft) = {
        let _guard = state.gate.lock().await;
        ensure_idle(state).await?;
        let mut store = coding_catalog::load(app)?;
        match request {
            ProviderRequest::List => return coding_catalog::read(app).map(ProviderResult::saved),
            ProviderRequest::ProfileProviders { .. } => return Err(DesktopFailure::invalid_input()),
            ProviderRequest::Remove { id } => {
                if !store.providers.iter().any(|provider| provider.id == id) {
                    return Err(DesktopFailure::invalid_input());
                }
                store.providers.retain(|provider| provider.id != id);
                if !store.providers.iter().any(|provider| {
                    provider
                        .models
                        .iter()
                        .any(|model| model.id == store.default_model)
                }) {
                    store.default_model = store
                        .providers
                        .first()
                        .and_then(|provider| provider.models.first())
                        .map(|model| model.id.clone())
                        .unwrap_or_default();
                }
                if store.providers.is_empty() {
                    store.enabled = false;
                }
                return coding_catalog::write(app, store).map(ProviderResult::saved);
            }
            ProviderRequest::Preferences { enabled, effort } => {
                if !["low", "medium", "high", "xhigh"].contains(&effort.as_str())
                    || enabled && store.providers.is_empty()
                {
                    return Err(DesktopFailure::invalid_input());
                }
                let path = coding_config::owned(app, Path::new("config.toml"))?;
                let text = match fs::read_to_string(&path) {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
                    Err(_) => return Err(DesktopFailure::operation_failed()),
                };
                let mut document = text
                    .parse::<toml_edit::DocumentMut>()
                    .map_err(|_| DesktopFailure::invalid_input())?;
                document["model_reasoning_effort"] = toml_edit::value(effort);
                coding_config::write_bytes(&path, document.to_string().as_bytes())?;
                store.enabled = enabled;
                match coding_catalog::write(app, store) {
                    Ok(value) => return Ok(ProviderResult::saved(value)),
                    Err(error) => {
                        let restored = coding_config::write_bytes(&path, text.as_bytes()).is_ok();
                        coding_config::log(
                            app,
                            &format!("ERROR programming_preferences_rollback success={restored}"),
                        );
                        return Err(error);
                    }
                }
            }
            ProviderRequest::Save { draft } => (store, draft),
            ProviderRequest::SyncProfile { profile, provider } => {
                // Resolve the Profile outside the coding state gate; stopping tasks must remain responsive.
                drop(_guard);
                let imported: Imported = match profile_data(app, &profile, Some(&provider))
                    .await
                    .and_then(|value| {
                        serde_json::from_value(value)
                            .map_err(|_| DesktopFailure::operation_failed())
                    }) {
                    Ok(value) => value,
                    Err(_) => return Ok(ProviderResult::rejected(ValidationStage::Profile)),
                };
                (
                    store,
                    ProviderDraft {
                        id: None,
                        name: imported.name,
                        region: "custom".into(),
                        base_url: imported.base_url,
                        api_key: Some(imported.api_key),
                        models: imported.models,
                    },
                )
            }
        }
    };
    coding_catalog::validate_draft(&mut draft)?;
    let key = draft
        .api_key
        .as_ref()
        .filter(|key| !key.is_empty())
        .cloned()
        .or_else(|| {
            draft
                .id
                .as_ref()
                .and_then(|id| {
                    snapshot
                        .providers
                        .iter()
                        .find(|provider| &provider.id == id)
                })
                .map(|provider| provider.api_key.clone())
        })
        .filter(|key| !key.is_empty())
        .ok_or_else(DesktopFailure::invalid_input)?;
    coding_config::log(
        app,
        &format!(
            "programming_provider_validate operation={operation} models={}",
            draft.models.len()
        ),
    );
    let checked = tokio::time::timeout(
        Duration::from_secs(90),
        coding_validation::validate(&draft.base_url, &key, &draft.models),
    )
    .await
    .unwrap_or(Err(ValidationStage::Timeout));
    if let Err(stage) = checked {
        coding_config::log(app, &format!("ERROR programming_provider_validation_failed operation={operation} stage={stage:?}"));
        return Ok(ProviderResult::rejected(stage));
    }
    let _guard = state.gate.lock().await;
    ensure_idle(state).await?;
    if coding_catalog::load(app)?.revision != snapshot.revision {
        return Err(DesktopFailure::conflict());
    }
    coding_catalog::apply(app, snapshot, draft, key).map(ProviderResult::saved)
}

#[cfg(test)]
#[path = "tests/coding_providers.rs"]
mod tests;
