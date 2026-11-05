use super::{bot_chat_create_params, bot_group_request_shape, enable_bot_mode};
use serde_json::{json, Value};
use std::fs;
use uuid::Uuid;

#[test]
fn bot_marker_preserves_other_profile_metadata_and_is_idempotent() {
    let home = std::env::temp_dir().join(format!("hermess-bot-marker-{}", Uuid::new_v4()));
    fs::create_dir(&home).expect("temporary home");
    fs::write(
        home.join("profile.yaml"),
        "display_name: Writer\nui_meta:\n  other-client:\n    color: blue\n",
    )
    .expect("initial profile");
    enable_bot_mode(&home, "Writer").expect("first enable");
    let first = fs::read_to_string(home.join("profile.yaml")).expect("saved profile");
    let document: serde_yaml::Value = serde_yaml::from_str(&first).expect("valid YAML");
    assert_eq!(document["display_name"].as_str(), Some("Writer"));
    assert_eq!(
        document["ui_meta"]["other-client"]["color"].as_str(),
        Some("blue")
    );
    assert_eq!(
        document["ui_meta"]["hermes-bots"]["title"].as_str(),
        Some("Writer")
    );
    enable_bot_mode(&home, "Different").expect("second enable");
    assert_eq!(
        fs::read_to_string(home.join("profile.yaml")).unwrap(),
        first
    );
    let actual = fs::canonicalize(&home).expect("resolved temporary home");
    let temp_root = fs::canonicalize(std::env::temp_dir()).expect("resolved temp root");
    assert_eq!(actual.parent(), Some(temp_root.as_path()));
    fs::remove_dir_all(&actual).expect("remove isolated temporary home");
}

#[test]
fn production_bot_marker_for_gateway() {
    let Ok(home) = std::env::var("HERMESS_BOT_MARKER_HOME") else {
        return;
    };
    enable_bot_mode(std::path::Path::new(&home), "Writer").expect("enable Bot Mode in test home");
}

#[test]
fn production_bot_request_shapes_for_gateway() {
    let create = bot_chat_create_params("00000000-0000-4000-8000-000000000001");
    assert_eq!(create["title"], "Bot Chat");
    assert_eq!(create["follow_profile_config"], true);
    let (method, send) = bot_group_request_shape(
        "send",
        json!({
            "room_id": "room", "event_id": "00000000-0000-4000-8000-000000000002",
            "thread_id": "00000000-0000-4000-8000-000000000003", "text": "@writer hello"
        }),
    )
    .expect("production send shape");
    assert_eq!(method, "groups.send");
    assert_eq!(send["payload"]["text"], "@writer hello");
    assert!(send.get("text").is_none());

    let Ok(input_path) = std::env::var("HERMESS_BOT_SHAPE_INPUT") else {
        return;
    };
    let output_path = std::env::var("HERMESS_BOT_SHAPE_OUTPUT").expect("output path");
    let input: Value = serde_json::from_slice(&fs::read(input_path).expect("shape input"))
        .expect("valid shape input");
    let create = bot_chat_create_params(input["request_id"].as_str().expect("request id"));
    let create = super::super::profiles::scoped_params("writer", "session.create", create)
        .expect("named Profile create route");
    let mut output = serde_json::Map::new();
    output.insert(
        "chat_create".into(),
        json!({"method": "session.create", "params": create}),
    );
    for row in input["operations"].as_array().expect("operations") {
        let name = row["name"].as_str().expect("name");
        let operation = row["operation"].as_str().expect("operation");
        let (method, params) = bot_group_request_shape(operation, row["params"].clone())
            .expect("production group request shape");
        let params = super::super::profiles::scoped_params("default", method, params)
            .expect("default Profile route");
        output.insert(name.into(), json!({"method": method, "params": params}));
    }
    fs::write(
        output_path,
        serde_json::to_vec(&output).expect("shape JSON"),
    )
    .expect("write production shapes");
}
