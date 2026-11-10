use super::{
    auxiliary_assignment_matches, auxiliary_assignment_request, auxiliary_config,
    auxiliary_read_path, auxiliary_reset_request, checked_json_path, full_config_request,
    profile_http_client, read_config_json, write_config_json, AUXILIARY_CONFIG_PATH,
};
use serde_json::{json, Map, Value};
use std::fs;

#[test]
fn profile_http_requests_share_one_connection_pool() {
    let first = profile_http_client().unwrap();
    let second = profile_http_client().unwrap();
    assert!(std::ptr::eq(first, second));
}

#[test]
fn reset_auxiliary_request_scopes_read_and_write_to_the_same_profile() {
    let (body, read_path) = auxiliary_reset_request("team alpha").unwrap();
    assert_eq!(
        body,
        json!({
            "scope": "auxiliary", "task": "__reset__", "provider": "", "model": "", "profile": "team alpha"
        })
    );
    assert_eq!(read_path, "/api/model/auxiliary?profile=team+alpha");
}

#[test]
fn auxiliary_assignment_uses_locked_model_route_and_dynamic_task_shape() {
    assert_eq!(
        auxiliary_read_path("team alpha").unwrap(),
        "/api/model/auxiliary?profile=team+alpha"
    );
    assert_eq!(
        auxiliary_assignment_request(
            "team alpha",
            "review_plugin_2",
            "openrouter",
            "vendor/fast-model",
            "",
            false,
        )
        .unwrap(),
        json!({
            "scope": "auxiliary", "task": "review_plugin_2", "provider": "openrouter",
            "model": "vendor/fast-model", "reasoning_effort": null,
            "confirm_expensive_model": false, "profile": "team alpha",
        })
    );
    assert!(auxiliary_assignment_request(
        "default",
        "unknown-task",
        "openrouter",
        "model",
        "",
        false
    )
    .is_err());
}

#[test]
fn auxiliary_assignment_readback_accepts_plugin_metadata() {
    let readback = json!({"tasks": [{
        "task": "review_plugin_2", "provider": "openrouter", "model": "vendor/fast-model",
        "reasoning_effort": "low", "label": "Review helper", "plugin": "review-plugin",
        "inherit_from": "review", "effective": {"provider": "openrouter", "model": "vendor/fast-model", "base_url": ""}
    }], "main": {"provider": "openrouter", "model": "vendor/main"}});
    assert!(auxiliary_assignment_matches(
        &readback,
        "review_plugin_2",
        "openrouter",
        "vendor/fast-model",
        "low"
    ));
    assert!(!auxiliary_assignment_matches(
        &readback,
        "review_plugin_2",
        "openrouter",
        "wrong",
        "low"
    ));
}

#[test]
fn supplemental_routes_require_schema_fields_and_keep_gateway_plugin_rows() {
    let mut routes = json!({"tasks": [{"task": "goal_judge", "plugin": "plugin-probe"}]});
    let schema = json!({"fields": {
        "auxiliary.goal_judge.provider": {}, "auxiliary.goal_judge.model": {},
        "auxiliary.background_review.provider": {}, "auxiliary.background_review.model": {},
        "auxiliary.monitor.provider": {},
        "auxiliary.moa_reference.provider": {}, "auxiliary.moa_reference.model": {},
    }});
    let config = json!({"auxiliary": {
        "background_review": {
            "provider": "openrouter", "model": "probe/model",
            "api_key": "fixture-only", "reasoning_effort": "low"
        },
    }});
    let expected = ["background_review"];
    assert_eq!(
        auxiliary_config::supplemental_tasks(&routes, &schema),
        expected
    );
    let patch = auxiliary_config::reset_patch(&routes, &schema, &config);
    assert_eq!(patch.len(), 1);
    assert_eq!(patch["background_review"]["reasoning_effort"], "");
    auxiliary_config::append_supplemental_tasks(&mut routes, &schema, &config);
    assert_eq!(routes["tasks"].as_array().unwrap().len(), 2);
    assert_eq!(routes["tasks"][0]["plugin"], "plugin-probe");
    assert!(auxiliary_assignment_matches(
        &routes,
        "background_review",
        "openrouter",
        "probe/model",
        ""
    ));
    assert!(routes["tasks"][1].get("api_key").is_none());
}

#[test]
#[ignore = "Print production requests for the isolated locked Gateway receiver test"]
fn print_production_supplemental_auxiliary_requests() {
    let profile = "auxiliary_probe";
    let initial = json!({
        "vision": {"provider": "openrouter", "model": "probe/vision"},
        "memory_query_rewrite": {"reasoning_effort": "low"},
        "background_review": {
            "provider": "openai", "model": "probe/old", "enabled": false, "timeout": 77,
            "base_url": "http://127.0.0.1:9/v1", "api_key": "fixture-only",
            "api": "fixture-only", "key_env": "AUX_TEST_KEY", "api_key_env": "AUX_TEST_KEY",
            "api_mode": "chat_completions",
        },
    });
    let names = [
        "background_review",
        "memory_query_rewrite",
        "tts_audio_tags",
        "goal_judge",
        "group_router",
        "monitor",
    ];
    let schema_fields = names
        .iter()
        .flat_map(|task| {
            ["provider", "model", "reasoning_effort"]
                .into_iter()
                .filter(move |field| {
                    *task != "memory_query_rewrite" || *field != "reasoning_effort"
                })
                .map(move |field| (format!("auxiliary.{task}.{field}"), json!({})))
        })
        .collect::<Map<String, Value>>();
    let schema = json!({"fields": schema_fields});
    let routes = json!({"tasks": [{"task": "vision"}]});
    let initial_config = json!({"auxiliary": initial});
    let mut saved_config = initial_config.clone();
    let requests: Vec<_> = names
        .into_iter()
        .map(|task| {
            let effort =
                auxiliary_config::has_field(&schema, task, "reasoning_effort").then_some("low");
            let route = auxiliary_config::route_patch(
                &initial_config["auxiliary"][task],
                "openrouter",
                &format!("probe/{task}"),
                effort,
                (task == "background_review").then_some(91.5),
                false,
            );
            let current = saved_config["auxiliary"]
                .as_object_mut()
                .unwrap()
                .entry(task.to_owned())
                .or_insert_with(|| json!({}));
            current
                .as_object_mut()
                .unwrap()
                .extend(route.as_object().unwrap().clone());
            auxiliary_config::patch_request(&Map::from_iter([(task.to_owned(), route)]))
        })
        .collect();
    let reset_patch = auxiliary_config::reset_patch(&routes, &schema, &saved_config);
    let (reset, read_path) = auxiliary_reset_request(profile).unwrap();
    println!(
        "SUPPLEMENTAL_AUXILIARY_REQUESTS={}",
        json!({
            "profile": profile, "initial_config": initial_config,
            "path": AUXILIARY_CONFIG_PATH, "requests": requests,
            "reset_model_set": reset, "reset_patch": auxiliary_config::patch_request(&reset_patch),
            "read_path": read_path,
        })
    );
}

#[test]
#[ignore = "Print production request shape for the isolated locked Gateway receiver test"]
fn print_production_auxiliary_assignment_request_shape() {
    let profile = "default";
    let body = auxiliary_assignment_request(
        profile,
        "desktop_probe_task",
        "openrouter",
        "vendor/probe-model",
        "low",
        false,
    )
    .unwrap();
    println!(
        "AUX_ASSIGNMENT_SHAPE={}",
        json!({
            "method": "POST", "path": "/api/model/set", "body": body,
            "read_path": auxiliary_read_path(profile).unwrap(),
        })
    );
}

#[test]
#[ignore = "Print production request shape for the isolated locked Gateway receiver test"]
fn print_production_auxiliary_reset_request_shape() {
    let (body, read_path) = auxiliary_reset_request("default").unwrap();
    println!(
        "AUX_RESET_SHAPE={}",
        json!({
            "method": "POST", "path": "/api/model/set", "body": body, "read_path": read_path,
        })
    );
}

#[test]
fn full_config_request_rejects_non_object_and_wraps_object() {
    assert!(full_config_request(json!(["not", "an", "object"])).is_err());
    assert_eq!(
        full_config_request(json!({"display":{"language":"zh-CN"}})).unwrap(),
        json!({"config":{"display":{"language":"zh-CN"}}})
    );
}

#[test]
fn config_json_file_helpers_require_object_json_and_do_not_overwrite() {
    let directory =
        std::env::temp_dir().join(format!("hermess-config-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&directory).unwrap();
    let source = directory.join("source.json");
    let target = directory.join("target.json");
    fs::write(&source, br#"{"agent":{"reasoning_effort":"high"}}"#).unwrap();
    assert_eq!(
        read_config_json(&source).unwrap(),
        json!({"agent":{"reasoning_effort":"high"}})
    );
    fs::write(directory.join("array.json"), b"[]").unwrap();
    assert!(read_config_json(&directory.join("array.json")).is_err());
    let (bytes, cleanup_ok) =
        write_config_json(&target, &json!({"tools":{"enabled":true}})).unwrap();
    assert!(bytes > 0);
    assert!(cleanup_ok);
    assert_eq!(
        read_config_json(&target).unwrap(),
        json!({"tools":{"enabled":true}})
    );
    assert!(write_config_json(&target, &json!({})).is_err());
    assert!(checked_json_path(target.to_string_lossy().as_ref()).is_ok());
    assert!(checked_json_path(directory.join("config.yaml").to_string_lossy().as_ref()).is_err());
    fs::remove_dir_all(directory).unwrap();
}

#[test]
#[ignore = "Print production request shape for the isolated locked Gateway receiver test"]
fn print_production_full_config_request_shape() {
    let body = full_config_request(json!({
        "display": {"language": "zh-CN"},
        "agent": {"reasoning_effort": "high"}
    }))
    .unwrap();
    println!(
        "FULL_CONFIG_SHAPE={}",
        json!({"method":"PUT","path":"/api/config","defaults_path":"/api/config/defaults","body":body})
    );
}
