use super::{coding_config, coding_vault};
use crate::{errors::DesktopFailure, paths::filesystem_path};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
pub struct CodingModel {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Serialize)]
pub struct CodingProvider {
    pub id: String,
    pub name: String,
    pub region: String,
    pub base_url: String,
    pub has_key: bool,
    pub models: Vec<CodingModel>,
}
#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Provider {
    pub id: String,
    pub name: String,
    pub region: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<CodingModel>,
}
#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Store {
    pub revision: String,
    pub enabled: bool,
    pub default_model: String,
    pub providers: Vec<Provider>,
}
#[derive(Serialize)]
pub struct CodingCatalog {
    pub revision: String,
    pub enabled: bool,
    pub effort: String,
    pub default_model: String,
    pub providers: Vec<CodingProvider>,
}
#[derive(Clone, Deserialize)]
pub struct ProviderDraft {
    pub id: Option<String>,
    pub name: String,
    pub region: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub models: Vec<String>,
}

pub(super) fn exists(app: &AppHandle) -> Result<bool, DesktopFailure> {
    Ok(filesystem_path(&coding_config::owned(app, Path::new("connections.enc"))?).is_file())
}
pub(super) fn load(app: &AppHandle) -> Result<Store, DesktopFailure> {
    let path = coding_config::owned(app, Path::new("connections.enc"))?;
    match fs::read(filesystem_path(&path)) {
        Ok(bytes) => {
            coding_config::owned(app, Path::new("vault/master.key"))?;
            let raw = coding_vault::decrypt(&coding_config::root(app)?.join("vault"), &bytes)?;
            serde_json::from_slice(&raw).map_err(|_| DesktopFailure::operation_failed())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut store = Store {
                revision: "legacy".into(),
                enabled: false,
                default_model: String::new(),
                providers: vec![],
            };
            if let Some(old) = coding_config::legacy(app)? {
                store.enabled = old.enabled;
                store.default_model = old.id.clone();
                store.providers.push(Provider {
                    id: old.id.clone(),
                    name: "Imported connection".into(),
                    region: "custom".into(),
                    base_url: old.base_url,
                    api_key: old.api_key,
                    models: vec![CodingModel {
                        id: old.id,
                        name: old.model,
                    }],
                });
            }
            if let Ok(bytes) = fs::read(filesystem_path(&coding_config::owned(
                app,
                Path::new("connection.enc"),
            )?)) {
                store.revision = format!("legacy-{:x}", Sha256::digest(bytes));
            }
            Ok(store)
        }
        Err(_) => Err(DesktopFailure::operation_failed()),
    }
}
pub(super) fn write(app: &AppHandle, mut store: Store) -> Result<CodingCatalog, DesktopFailure> {
    let root = coding_config::root(app)?;
    super::coding_vault::private_directory(&root)?;
    store.revision = Uuid::new_v4().to_string();
    let snapshot = snapshot(app, store.clone())?;
    let first = !exists(app)? && coding_config::legacy(app)?.is_none();
    let bytes = coding_vault::encrypt(
        &root.join("vault"),
        &serde_json::to_vec(&store).map_err(|_| DesktopFailure::operation_failed())?,
        first,
    )?;
    coding_config::write_bytes(
        &coding_config::owned(app, Path::new("connections.enc"))?,
        &bytes,
    )?;
    let legacy = coding_config::owned(app, Path::new("connection.enc"))?;
    if legacy.is_file() && fs::remove_file(filesystem_path(&legacy)).is_err() {
        coding_config::log(app, "ERROR programming_catalog_legacy_cleanup_failed");
    }
    Ok(snapshot)
}
pub(super) fn snapshot(app: &AppHandle, store: Store) -> Result<CodingCatalog, DesktopFailure> {
    Ok(CodingCatalog {
        revision: store.revision,
        enabled: store.enabled,
        effort: coding_config::read_effort(app)?,
        default_model: store.default_model,
        providers: store
            .providers
            .into_iter()
            .map(|provider| CodingProvider {
                id: provider.id,
                name: provider.name,
                region: provider.region,
                base_url: provider.base_url,
                has_key: !provider.api_key.is_empty(),
                models: provider.models,
            })
            .collect(),
    })
}
pub(super) fn read(app: &AppHandle) -> Result<CodingCatalog, DesktopFailure> {
    snapshot(app, load(app)?)
}
pub(super) fn route(
    app: &AppHandle,
    model_id: Option<&str>,
) -> Result<(coding_config::CodingConfig, String), DesktopFailure> {
    let store = load(app)?;
    let id = model_id.unwrap_or(&store.default_model);
    let picked = store.providers.iter().find_map(|provider| {
        provider
            .models
            .iter()
            .find(|model| model.id == id)
            .map(|model| (provider, model))
    });
    let Some((provider, model)) = picked else {
        return Err(DesktopFailure::invalid_input());
    };
    Ok((
        coding_config::CodingConfig {
            id: model.id.clone(),
            enabled: store.enabled,
            base_url: provider.base_url.clone(),
            model: model.name.clone(),
            effort: coding_config::read_effort(app)?,
            executable: super::coding_runtime::executable(app)
                .ok()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_default(),
            has_key: !provider.api_key.is_empty(),
            ignored_fields: coding_config::ignored_fields(app)?,
        },
        provider.api_key.clone(),
    ))
}
pub(super) fn validate_draft(draft: &mut ProviderDraft) -> Result<(), DesktopFailure> {
    draft.name = draft.name.trim().to_owned();
    draft.base_url = draft.base_url.trim().trim_end_matches('/').to_owned();
    draft.models = draft
        .models
        .iter()
        .map(|model| model.trim().to_owned())
        .collect();
    if draft.name.is_empty()
        || draft.name.len() > 160
        || draft.name.chars().any(char::is_control)
        || !["domestic", "overseas", "custom"].contains(&draft.region.as_str())
        || draft.models.is_empty()
        || draft.models.len() > 32
    {
        return Err(DesktopFailure::invalid_input());
    }
    let mut seen = std::collections::HashSet::new();
    for model in &draft.models {
        if !seen.insert(model.clone()) {
            return Err(DesktopFailure::invalid_input());
        }
        coding_config::validate(&coding_config::CodingConfigDraft {
            enabled: true,
            base_url: draft.base_url.clone(),
            model: model.clone(),
            effort: "medium".into(),
            api_key: draft.api_key.clone(),
        })?;
    }
    if let Some(id) = &draft.id {
        Uuid::parse_str(id).map_err(|_| DesktopFailure::invalid_input())?;
    }
    Ok(())
}
pub(super) fn apply(
    app: &AppHandle,
    mut store: Store,
    draft: ProviderDraft,
    key: String,
) -> Result<CodingCatalog, DesktopFailure> {
    let old = draft
        .id
        .as_ref()
        .and_then(|id| store.providers.iter().find(|provider| &provider.id == id));
    if draft.id.is_some() && old.is_none() {
        return Err(DesktopFailure::invalid_input());
    }
    let models = draft
        .models
        .iter()
        .map(|name| CodingModel {
            name: name.clone(),
            id: old
                .filter(|provider| provider.base_url == draft.base_url)
                .and_then(|provider| provider.models.iter().find(|model| &model.name == name))
                .map(|model| model.id.clone())
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
        })
        .collect::<Vec<_>>();
    let id = draft.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let default_was_here = old.is_some_and(|provider| {
        provider
            .models
            .iter()
            .any(|model| model.id == store.default_model)
    });
    if store.default_model.is_empty() || default_was_here {
        store.default_model = models
            .iter()
            .find(|model| model.id == store.default_model)
            .unwrap_or(&models[0])
            .id
            .clone();
    }
    let provider = Provider {
        id: id.clone(),
        name: draft.name,
        region: draft.region,
        base_url: draft.base_url,
        api_key: key,
        models,
    };
    if let Some(index) = store
        .providers
        .iter()
        .position(|provider| provider.id == id)
    {
        store.providers[index] = provider;
    } else {
        store.providers.push(provider);
    }
    store.enabled = true;
    write(app, store)
}

#[cfg(test)]
#[path = "tests/coding_catalog.rs"]
mod tests;
