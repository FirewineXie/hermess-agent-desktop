"""Resolve one product Profile API-key route into a private desktop pipe."""
import json
import os
import sys


def resolve(provider_override=None, model_override=None):
    from hermes_cli.config import load_config, load_env, split_model_config_default
    protected = {"HOME", "USERPROFILE", "HERMES_HOME", "HERMES_PROCESS_HOME", "HERMES_INSTALL_ROOT", "PYTHONPATH", "PYTHONHOME", "PATH"}
    os.environ.update({name: value for name, value in load_env().items()
                       if name not in protected and not name.startswith(("CODEX_", "HERMESS_"))})
    config = load_config()
    raw = config.get("model") or {}
    if isinstance(raw, str):
        model, provider = raw, os.environ.get("HERMES_INFERENCE_PROVIDER", "")
    else:
        model, nested = split_model_config_default(raw.get("default") or raw.get("model") or raw.get("name") or "")
        provider = raw.get("provider") or nested or os.environ.get("HERMES_INFERENCE_PROVIDER", "")
        if raw.get("openai_runtime") == "codex_app_server":
            raise ValueError("static_api_key_required")
    provider = provider_override or provider
    model = model_override or model
    if not model or not provider or provider == "auto":
        raise ValueError("static_api_key_required")
    from hermes_cli.providers import get_provider
    from hermes_cli.runtime_provider_custom import _get_named_custom_provider
    from hermes_cli.runtime_provider import resolve_runtime_provider, has_usable_secret
    custom = _get_named_custom_provider(provider, config=config, resolve_credentials=False)
    definition = get_provider(provider)
    if custom:
        if custom.get("key_cmd") or custom.get("extra_headers"):
            raise ValueError("static_api_key_required")
    elif definition is None or definition.auth_type != "api_key":
        raise ValueError("static_api_key_required")
    runtime = resolve_runtime_provider(requested=provider, target_model=model)
    key = runtime.get("api_key")
    if not isinstance(key, str) or not has_usable_secret(key) or runtime.get("extra_headers") or runtime.get("api_mode") == "codex_app_server":
        raise ValueError("static_api_key_required")
    return {"base_url": runtime.get("base_url") or "", "api_key": key, "model": model}


def catalog(models_file):
    from pathlib import Path
    from hermes_cli.config import load_config, load_env, split_model_config_default, is_provider_enabled
    from hermes_cli.providers import custom_provider_slug, get_provider
    from hermes_cli.runtime_provider_custom import _get_named_custom_provider
    config = load_config()
    raw = config.get("model") or {}
    model, nested = split_model_config_default(raw.get("default") or raw.get("model") or raw.get("name") or "") if isinstance(raw, dict) else (raw, "")
    main_provider = (raw.get("provider") or nested) if isinstance(raw, dict) else ""
    main_provider = main_provider or load_env().get("HERMES_INFERENCE_PROVIDER", "")
    saved = {}
    path = Path(models_file)
    if path.is_file():
        if path.stat().st_size > 1024 * 1024:
            raise ValueError("model_lists_too_large")
        saved = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(saved, dict):
            raise ValueError("invalid_model_lists")
    candidates = []
    for key, entry in (config.get("providers") or {}).items():
        if isinstance(entry, dict) and is_provider_enabled(entry):
            candidates.append((custom_provider_slug(entry.get("name", key), key), key, entry))
    for entry in config.get("custom_providers") or []:
        if isinstance(entry, dict) and entry.get("name") and is_provider_enabled(entry):
            candidates.append((custom_provider_slug(entry["name"]), custom_provider_slug(entry["name"]), entry))
    if main_provider and main_provider != "auto" and not any(item[0] == main_provider for item in candidates):
        custom = _get_named_custom_provider(main_provider, config=config, resolve_credentials=False)
        definition = get_provider(main_provider)
        if custom is None and definition is not None and definition.auth_type == "api_key":
            candidates.append((main_provider, main_provider, {"name":definition.name,"base_url":raw.get("base_url", "") if isinstance(raw, dict) else "", "default_model":model}))
    profile_env = load_env()
    for slug, models in saved.items():
        if not isinstance(slug, str) or not isinstance(models, list) or not models or any(slug in (item[0], item[1]) for item in candidates):
            continue
        definition = get_provider(slug, allow_network=False)
        if definition and definition.auth_type == "api_key" and any(profile_env.get(key) for key in definition.api_key_env_vars):
            candidates.append((slug, slug, {"name":definition.name,"base_url":profile_env.get(definition.base_url_env_var) or definition.base_url,"models":models}))
    result, seen = [], set()
    for slug, key, entry in candidates:
        if slug in seen or entry.get("key_cmd") or entry.get("extra_headers"):
            continue
        seen.add(slug)
        configured = entry.get("models") or []
        ids = list(configured) if isinstance(configured, (dict, list)) else []
        ids = saved.get(key, saved.get(slug, ids))
        if not isinstance(ids, list) or any(not isinstance(value, str) for value in ids):
            raise ValueError("invalid_model_lists")
        initial = entry.get("default_model") or entry.get("model") or ""
        if slug == main_provider or key == main_provider:
            initial = model or initial
        ids = list(dict.fromkeys(value.strip() for value in [*ids, initial] if isinstance(value, str) and value.strip()))
        if not ids:
            continue
        result.append({"id":slug,"name":entry.get("name") or str(key),"base_url":entry.get("base_url") or entry.get("api") or entry.get("url") or "", "models":ids})
    return result


def request():
    raw = os.environ.get("HERMESS_PROFILE_IMPORT_REQUEST")
    if not raw:
        return resolve()
    args = json.loads(raw)
    providers = catalog(args["models_file"])
    if args.get("provider") is None:
        return providers
    selected = next(item for item in providers if item["id"] == args["provider"])
    resolved = resolve(selected["id"], selected["models"][0])
    return {**resolved,"name":selected["name"],"models":selected["models"]}


if __name__ == "__main__":
    try:
        value = request()
        if len(json.dumps(value)) > 1024 * 1024:
            raise ValueError("route_too_large")
        print(json.dumps(value), flush=True)
    except Exception:
        # Auth helpers can echo credential values in exceptions; never forward them.
        sys.exit(3)
