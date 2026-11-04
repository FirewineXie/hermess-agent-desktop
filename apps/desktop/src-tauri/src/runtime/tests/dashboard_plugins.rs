use super::{
    dashboard_request_url, excluded_account_request, excluded_toolset_provider_request,
    filter_excluded_account_provider, plugin_api_url, plugin_ws_request, request_profile_is_bound,
    response_was_redirected, safe_manifest, safe_response_headers, safe_response_url,
    safe_status_text, valid_asset_path, valid_plugin_name, valid_tab_path,
};
use base64::Engine;
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Method, Url,
};
use serde_json::json;

#[test]
fn dashboard_plugin_manifest_and_api_routes_are_bounded() {
    assert!(valid_plugin_name("hermes-achievements"));
    assert!(valid_asset_path("dist/index.js"));
    assert!(valid_tab_path("/achievements"));
    assert!(plugin_api_url(8765, "/api/plugins/hermes-achievements/stats?mode=all").is_ok());
    for path in [
        "/api/config/raw",
        "/api/plugins/../config",
        "/api/plugins/x\\escape",
    ] {
        assert!(plugin_api_url(8765, path).is_err(), "{path}");
    }
    assert!(safe_manifest(&json!({
        "name": "hermes-achievements", "label": "Achievements", "entry": "dist/index.js",
        "tab": {"path": "/achievements"}, "slots": [], "has_api": true,
    }))
    .is_some());
    assert!(safe_manifest(&json!({
        "name": "unsafe", "label": "Unsafe", "entry": "../secret.js",
        "tab": {"path": "/unsafe"},
    }))
    .is_none());

    let token = plugin_ws_request(
        8765,
        "X-Hermes-Session-Token",
        "session secret",
        "/api/plugins/example/events?after=7",
    )
    .expect("loopback request");
    assert!(
        token.uri().to_string().contains("token=session+secret")
            || token.uri().to_string().contains("token=session%20secret")
    );
    let ticket = plugin_ws_request(
        8765,
        "X-Hermes-Gateway-Ticket",
        "native-ticket",
        "/api/plugins/example/events",
    )
    .expect("native request");
    assert_eq!(ticket.headers()["X-Hermes-Gateway-Ticket"], "native-ticket");
    assert!(!ticket.uri().to_string().contains("native-ticket"));
}

#[test]
fn dashboard_plugin_response_metadata_exposes_only_safe_headers() {
    let mut headers = HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        HeaderValue::from_static("application/pdf"),
    );
    headers.insert(
        reqwest::header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=report.pdf"),
    );
    headers.insert(
        reqwest::header::SET_COOKIE,
        HeaderValue::from_static("hermes_session=secret"),
    );
    headers.insert(
        reqwest::header::AUTHORIZATION,
        HeaderValue::from_static("Bearer secret"),
    );
    headers.insert("x-hermes-session-token", HeaderValue::from_static("secret"));

    let safe = safe_response_headers(&headers);
    assert_eq!(safe.len(), 2);
    assert_eq!(safe["content-type"], "application/pdf");
    assert_eq!(
        safe["content-disposition"],
        "attachment; filename=report.pdf"
    );
    for sensitive in ["set-cookie", "authorization", "x-hermes-session-token"] {
        assert!(!safe.contains_key(sensitive), "{sensitive}");
    }
}

#[test]
fn dashboard_plugin_response_metadata_uses_a_synthetic_origin() {
    let requested = Url::parse(
        "http://127.0.0.1:8765/api/plugins/example/download?profile=research&file=report.pdf",
    )
    .unwrap();
    let same = requested.clone();
    let redirected = Url::parse("https://external.example/final?ticket=secret").unwrap();

    assert_eq!(
        safe_response_url(&requested),
        "http://hermess.local/api/plugins/example/download?profile=research&file=report.pdf"
    );
    assert!(!safe_response_url(&requested).contains("8765"));
    assert!(!response_was_redirected(&requested, &same));
    assert!(response_was_redirected(&requested, &redirected));
    assert_eq!(safe_status_text(reqwest::StatusCode::OK), "OK");
    assert_eq!(
        safe_status_text(reqwest::StatusCode::from_u16(599).unwrap()),
        ""
    );
}

#[test]
fn dashboard_sdk_core_api_is_an_explicit_method_aware_allowlist() {
    for (method, path) in [
        (Method::GET, "/api/cron/jobs?profile=default"),
        (
            Method::POST,
            "/api/cron/jobs/task-1/trigger?profile=default",
        ),
        (Method::GET, "/api/skills?profile=default"),
        (
            Method::GET,
            "/api/sessions/session-1/messages?profile=default",
        ),
        (Method::PUT, "/api/config/raw?profile=default"),
        (Method::GET, "/api/config/raw?profile=default"),
        (Method::POST, "/api/model/set?profile=default"),
        (Method::POST, "/api/ops/backup?profile=default"),
        (Method::POST, "/api/dashboard/agent-plugins/install"),
        (Method::GET, "/api/dashboard/plugins/rescan?profile=default"),
        (Method::PUT, "/api/mcp/servers/server-1/enabled"),
        (Method::POST, "/api/messaging/platforms/telegram/test"),
        (
            Method::POST,
            "/api/messaging/telegram/onboarding/pair-1/apply",
        ),
        (Method::PUT, "/api/memory/providers/mem0/config"),
        (Method::PUT, "/api/webhooks/build/enabled"),
    ] {
        let (_, owner) = dashboard_request_url(8765, &method, path).expect(path);
        assert_eq!(owner, "core-api");
    }
    for (method, path) in [
        (Method::POST, "/api/gateway/restart"),
        (Method::GET, "/api/portal"),
        (Method::POST, "/api/hermes/update"),
        (Method::POST, "/api/auth/logout"),
        (Method::PUT, "/api/model/set"),
        (
            Method::POST,
            "/api/dashboard/plugins/rescan?profile=default",
        ),
        (Method::POST, "/api/cron/jobs/task-1"),
        (Method::GET, "/api/webhooks/build/enabled"),
        (Method::GET, "/api/plugins/../config"),
        (Method::GET, "/api/%2e%2e/config"),
    ] {
        assert!(
            dashboard_request_url(8765, &method, path).is_err(),
            "{method} {path}"
        );
    }
}

#[test]
fn dashboard_sdk_local_models_routes_are_profile_bound_and_method_aware() {
    for (method, path) in [
        (Method::GET, "/api/local-models/status?profile=default"),
        (Method::GET, "/api/local-models/hardware?profile=default"),
        (Method::GET, "/api/local-models/catalog?profile=default"),
        (
            Method::POST,
            "/api/local-models/runtime/install?profile=default",
        ),
        (Method::POST, "/api/local-models/download?profile=default"),
        (
            Method::POST,
            "/api/local-models/download/pause?profile=default",
        ),
        (
            Method::POST,
            "/api/local-models/download/resume?profile=default",
        ),
        (
            Method::DELETE,
            "/api/local-models/models/model-1?profile=default",
        ),
        (Method::POST, "/api/local-models/quickstart?profile=default"),
        (Method::POST, "/api/local-models/server?profile=default"),
        (Method::POST, "/api/local-models/eject?profile=default"),
        (Method::POST, "/api/local-models/activate?profile=default"),
        (Method::GET, "/api/local-models/jobs?profile=default"),
        (Method::GET, "/api/local-models/jobs/job-1?profile=default"),
        (Method::GET, "/api/local-models/search?profile=default"),
        (
            Method::GET,
            "/api/local-models/search/files?profile=default",
        ),
        (
            Method::POST,
            "/api/local-models/download-browsed?profile=default",
        ),
        (Method::POST, "/api/local-models/sideload?profile=default"),
    ] {
        let (url, _) = dashboard_request_url(8765, &method, path).expect(path);
        assert!(
            request_profile_is_bound(&url, &json!({}), "default"),
            "{method} {path}"
        );
    }
    let (missing_profile, _) =
        dashboard_request_url(8765, &Method::GET, "/api/local-models/status")
            .expect("route shape remains valid before owner-profile validation");
    assert!(!request_profile_is_bound(
        &missing_profile,
        &json!({}),
        "default"
    ));
    for (method, path) in [
        (Method::POST, "/api/local-models/status?profile=default"),
        (
            Method::GET,
            "/api/local-models/models/model-1?profile=default",
        ),
        (Method::DELETE, "/api/local-models/catalog?profile=default"),
    ] {
        assert!(
            dashboard_request_url(8765, &method, path).is_err(),
            "{method} {path}"
        );
    }
}

#[test]
fn dashboard_plugin_oauth_excludes_nous_accounts_without_removing_model_support() {
    let list = dashboard_request_url(8765, &Method::GET, "/api/providers/oauth?profile=default")
        .expect("OAuth catalog route")
        .0;
    let filtered = filter_excluded_account_provider(
        &list,
        serde_json::to_vec(&json!({
            "providers": [
                {"id": "nous", "name": "Nous Portal"},
                {"id": "openai-codex", "name": "ChatGPT or Codex Subscription"}
            ]
        }))
        .unwrap(),
    )
    .expect("filtered OAuth catalog");
    let body: serde_json::Value = serde_json::from_slice(&filtered).unwrap();
    assert_eq!(body["providers"].as_array().unwrap().len(), 1);
    assert_eq!(body["providers"][0]["id"], "openai-codex");

    for path in [
        "/api/providers/oauth/nous",
        "/api/providers/oauth/nous/start",
        "/api/providers/oauth/nous/handoff",
        "/api/providers/oauth/%6eous/start",
    ] {
        let method = if path.ends_with("/start") {
            Method::POST
        } else if path.ends_with("/handoff") {
            Method::GET
        } else {
            Method::DELETE
        };
        if let Ok((url, _)) = dashboard_request_url(8765, &method, path) {
            assert!(excluded_account_request(&url), "{method} {path}");
        }
    }

    let other = dashboard_request_url(
        8765,
        &Method::POST,
        "/api/providers/oauth/openai-codex/start",
    )
    .expect("other OAuth provider route")
    .0;
    assert!(!excluded_account_request(&other));
    let model = dashboard_request_url(8765, &Method::GET, "/api/model/options?profile=default")
        .expect("model provider catalog remains available")
        .0;
    assert!(!excluded_account_request(&model));
}

#[test]
fn dashboard_plugin_toolset_config_hides_managed_nous_entitlements() {
    let url = dashboard_request_url(
        8765,
        &Method::GET,
        "/api/tools/toolsets/web/config?profile=default",
    )
    .expect("toolset config route")
    .0;
    let filtered = filter_excluded_account_provider(
        &url,
        serde_json::to_vec(&json!({
            "providers": [
                {
                    "name": "Auth-gated managed row",
                    "requires_nous_auth": true,
                    "managed_nous_feature": null
                },
                {
                    "name": "Nous Subscription",
                    "requires_nous_auth": false,
                    "managed_nous_feature": "web"
                },
                {
                    "name": "Firecrawl",
                    "requires_nous_auth": false,
                    "managed_nous_feature": null
                },
                {"name": "Local Browser", "env_vars": []}
            ],
            "active_provider": "Nous Subscription",
            "active_search_backend": "firecrawl",
            "active_extract_backend": "local",
            "search_via_nous": true,
            "extract_via_nous": false
        }))
        .unwrap(),
    )
    .expect("filtered toolset config");
    let body: serde_json::Value = serde_json::from_slice(&filtered).unwrap();
    assert_eq!(body["providers"].as_array().unwrap().len(), 2);
    assert_eq!(body["providers"][0]["name"], "Firecrawl");
    assert_eq!(body["providers"][1]["name"], "Local Browser");
    assert!(body["active_provider"].is_null());
    assert_eq!(body["search_via_nous"], false);
    assert!(body["active_search_backend"].is_null());
    assert_eq!(body["extract_via_nous"], false);
    assert_eq!(body["active_extract_backend"], "local");
}

#[test]
fn dashboard_plugin_toolset_provider_write_rejects_only_managed_nous_rows() {
    let url = dashboard_request_url(
        8765,
        &Method::PUT,
        "/api/tools/toolsets/browser/provider?profile=default",
    )
    .expect("toolset provider route")
    .0;
    for provider in ["Nous Subscription", "Nous Subscription (Browser Use cloud)"] {
        assert!(excluded_toolset_provider_request(
            &url,
            &json!({"body": {"provider": provider, "profile": "default"}})
        )
        .unwrap());
    }
    for provider in ["Browser Use", "Local Browser", "Firecrawl"] {
        assert!(!excluded_toolset_provider_request(
            &url,
            &json!({"body": {"provider": provider, "profile": "default"}})
        )
        .unwrap());
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(
        serde_json::to_vec(&json!({
            "provider": "Nous Subscription",
            "profile": "default"
        }))
        .unwrap(),
    );
    assert!(excluded_toolset_provider_request(
        &url,
        &json!({"body_base64": encoded, "content_type": "application/json"})
    )
    .unwrap());

    let model = dashboard_request_url(8765, &Method::GET, "/api/model/options?profile=default")
        .expect("model provider catalog remains available")
        .0;
    assert!(
        !excluded_toolset_provider_request(&model, &json!({"body": {"provider": "nous"}})).unwrap()
    );
}

#[test]
fn dashboard_management_routes_match_locked_skills_plugins_and_mcp_sdk() {
    for (method, path) in [
        (Method::GET, "/api/skills?profile=default"),
        (Method::POST, "/api/skills?profile=default"),
        (Method::GET, "/api/skills/content?name=demo&profile=default"),
        (Method::PUT, "/api/skills/content?profile=default"),
        (Method::PUT, "/api/skills/toggle?profile=default"),
        (Method::GET, "/api/skills/hub/search?q=demo&profile=default"),
        (
            Method::GET,
            "/api/skills/hub/scan?identifier=demo&profile=default",
        ),
        (
            Method::GET,
            "/api/skills/hub/preview?identifier=demo&profile=default",
        ),
        (Method::POST, "/api/skills/hub/install?profile=default"),
        (Method::POST, "/api/skills/hub/uninstall?profile=default"),
        (Method::POST, "/api/skills/hub/update?profile=default"),
        (Method::GET, "/api/skills/hub/sources?profile=default"),
        (Method::GET, "/api/tools/toolsets?profile=default"),
        (Method::PUT, "/api/tools/toolsets/browser?profile=default"),
        (
            Method::GET,
            "/api/tools/toolsets/browser/config?profile=default",
        ),
        (
            Method::PUT,
            "/api/tools/toolsets/browser/provider?profile=default",
        ),
        (
            Method::PUT,
            "/api/tools/toolsets/browser/env?profile=default",
        ),
        (
            Method::POST,
            "/api/tools/toolsets/browser/post-setup?profile=default",
        ),
        (Method::GET, "/api/dashboard/plugins?profile=default"),
        (Method::GET, "/api/dashboard/plugins/rescan?profile=default"),
        (Method::GET, "/api/dashboard/plugins/hub?profile=default"),
        (
            Method::GET,
            "/api/dashboard/plugins/catalog?profile=default",
        ),
        (
            Method::POST,
            "/api/dashboard/agent-plugins/install?profile=default",
        ),
        (
            Method::POST,
            "/api/dashboard/agent-plugins/demo/enable?profile=default",
        ),
        (
            Method::POST,
            "/api/dashboard/agent-plugins/demo/disable?profile=default",
        ),
        (
            Method::POST,
            "/api/dashboard/agent-plugins/demo/update?profile=default",
        ),
        (
            Method::DELETE,
            "/api/dashboard/agent-plugins/demo?profile=default",
        ),
        (
            Method::PUT,
            "/api/dashboard/plugin-providers?profile=default",
        ),
        (
            Method::POST,
            "/api/dashboard/plugins/demo/visibility?profile=default",
        ),
        (
            Method::GET,
            "/api/memory/providers/demo/config?profile=default",
        ),
        (
            Method::PUT,
            "/api/memory/providers/demo/config?profile=default",
        ),
        (
            Method::POST,
            "/api/memory/providers/demo/setup?profile=default",
        ),
        (Method::PUT, "/api/memory/provider?profile=default"),
        (Method::GET, "/api/mcp/servers?profile=default"),
        (Method::POST, "/api/mcp/servers?profile=default"),
        (Method::POST, "/api/mcp/servers/demo/auth?profile=default"),
        (Method::GET, "/api/mcp/oauth/flows/flow-1?profile=default"),
        (Method::DELETE, "/api/mcp/servers/demo?profile=default"),
        (Method::POST, "/api/mcp/servers/demo/test?profile=default"),
        (Method::PUT, "/api/mcp/servers/demo/enabled?profile=default"),
        (Method::GET, "/api/mcp/catalog?profile=default"),
        (Method::POST, "/api/mcp/catalog/install?profile=default"),
    ] {
        let (_, owner) = dashboard_request_url(8765, &method, path).expect(path);
        assert_eq!(owner, "core-api", "{method} {path}");
    }
}

#[test]
fn dashboard_sdk_allowlist_accepts_every_locked_convenience_request_shape() {
    for (method, path) in [
        (Method::GET, "/api/status?profile=research"),
        (Method::GET, "/api/auth/me"),
        (
            Method::GET,
            "/api/sessions?limit=20&offset=0&order=created&profile=research",
        ),
        (
            Method::GET,
            "/api/sessions/fixture/messages?limit=500&order=latest&profile=research",
        ),
        (Method::GET, "/api/sessions/fixture?profile=research"),
        (Method::GET, "/api/chat/workspaces?profile=research"),
        (
            Method::GET,
            "/api/sessions/fixture/latest-descendant?profile=research",
        ),
        (
            Method::GET,
            "/api/sessions/fixture/mutation-snapshot?profile=research",
        ),
        (
            Method::DELETE,
            "/api/sessions/fixture?profile=research&ok=true",
        ),
        (Method::GET, "/api/sessions/empty/count?profile=research"),
        (Method::DELETE, "/api/sessions/empty?profile=research"),
        (Method::POST, "/api/sessions/bulk-delete?profile=research"),
        (Method::PATCH, "/api/sessions/fixture?profile=research"),
        (Method::GET, "/api/sessions/stats?profile=research"),
        (
            Method::GET,
            "/api/sessions/session-1/mutation-snapshot?profile=research",
        ),
        (Method::POST, "/api/sessions/import?profile=research"),
        (Method::POST, "/api/sessions/prune?profile=research"),
        (Method::GET, "/api/files?path=fixture"),
        (Method::GET, "/api/files/read?path=fixture"),
        (Method::POST, "/api/files/upload-stream"),
        (Method::POST, "/api/files/mkdir"),
        (Method::DELETE, "/api/files"),
        (Method::GET, "/api/logs?profile=research"),
        (
            Method::GET,
            "/api/analytics/usage?days=fixture&profile=research",
        ),
        (
            Method::GET,
            "/api/analytics/models?days=fixture&profile=research",
        ),
        (Method::GET, "/api/config?profile=research"),
        (Method::GET, "/api/config/defaults?profile=research"),
        (Method::GET, "/api/config/schema?profile=research"),
        (Method::GET, "/api/model/info?profile=research"),
        (
            Method::GET,
            "/api/model/options?include_unconfigured=1&profile=research",
        ),
        (Method::GET, "/api/model/auxiliary?profile=research"),
        (Method::GET, "/api/model/moa?profile=research"),
        (Method::PUT, "/api/model/moa?profile=research"),
        (Method::POST, "/api/model/set?profile=research"),
        (Method::GET, "/api/shared-metrics/consent?profile=research"),
        (Method::PUT, "/api/shared-metrics/consent?profile=research"),
        (Method::PUT, "/api/config?profile=research"),
        (Method::GET, "/api/config/raw?profile=research"),
        (Method::PUT, "/api/config/raw?profile=research"),
        (Method::GET, "/api/env?profile=research"),
        (Method::PUT, "/api/env?profile=research"),
        (Method::DELETE, "/api/env?profile=research"),
        (Method::POST, "/api/env/reveal?profile=research"),
        (Method::GET, "/api/cron/jobs?profile=research"),
        (Method::GET, "/api/cron/delivery-targets?profile=research"),
        (Method::POST, "/api/cron/jobs?profile=research"),
        (
            Method::POST,
            "/api/cron/jobs/fixture/pause?profile=research",
        ),
        (Method::PUT, "/api/cron/jobs/fixture?profile=research"),
        (
            Method::POST,
            "/api/cron/jobs/fixture/resume?profile=research",
        ),
        (
            Method::POST,
            "/api/cron/jobs/fixture/trigger?profile=research",
        ),
        (Method::DELETE, "/api/cron/jobs/fixture?profile=research"),
        (Method::GET, "/api/cron/blueprints?profile=research"),
        (
            Method::POST,
            "/api/cron/blueprints/instantiate?profile=research",
        ),
        (Method::GET, "/api/profiles"),
        (Method::GET, "/api/profiles/active"),
        (Method::POST, "/api/profiles/active"),
        (Method::POST, "/api/profiles"),
        (Method::PUT, "/api/profiles/fixture/description"),
        (Method::POST, "/api/profiles/fixture/describe-auto"),
        (Method::PUT, "/api/profiles/fixture/model"),
        (Method::PATCH, "/api/profiles/fixture"),
        (Method::DELETE, "/api/profiles/fixture"),
        (Method::GET, "/api/profiles/fixture/setup-command"),
        (Method::GET, "/api/profiles/fixture/soul"),
        (Method::PUT, "/api/profiles/fixture/soul"),
        (Method::GET, "/api/skills?profile=research"),
        (Method::PUT, "/api/skills/toggle?profile=research"),
        (
            Method::GET,
            "/api/skills/content?name=fixture&profile=research",
        ),
        (Method::POST, "/api/skills?profile=research"),
        (Method::PUT, "/api/skills/content?profile=research"),
        (Method::GET, "/api/tools/toolsets?profile=research"),
        (Method::PUT, "/api/tools/toolsets/fixture?profile=research"),
        (
            Method::GET,
            "/api/tools/toolsets/fixture/config?profile=research",
        ),
        (
            Method::PUT,
            "/api/tools/toolsets/fixture/provider?profile=research",
        ),
        (
            Method::PUT,
            "/api/tools/toolsets/fixture/env?profile=research",
        ),
        (
            Method::POST,
            "/api/tools/toolsets/fixture/post-setup?profile=research",
        ),
        (
            Method::GET,
            "/api/sessions/search?q=fixture&profile=research",
        ),
        (Method::GET, "/api/providers/oauth?profile=research"),
        (
            Method::DELETE,
            "/api/providers/oauth/fixture?profile=research",
        ),
        (
            Method::POST,
            "/api/providers/oauth/fixture/start?profile=research",
        ),
        (
            Method::POST,
            "/api/providers/oauth/fixture/submit?profile=research",
        ),
        (
            Method::GET,
            "/api/providers/oauth/fixture/poll/fixture?profile=research",
        ),
        (
            Method::DELETE,
            "/api/providers/oauth/sessions/fixture?profile=research",
        ),
        (Method::GET, "/api/messaging/platforms?profile=research"),
        (
            Method::PUT,
            "/api/messaging/platforms/fixture?profile=research",
        ),
        (
            Method::POST,
            "/api/messaging/platforms/fixture/test?profile=research",
        ),
        (
            Method::POST,
            "/api/messaging/telegram/onboarding/start?profile=research",
        ),
        (
            Method::GET,
            "/api/messaging/telegram/onboarding/fixture?profile=research",
        ),
        (
            Method::POST,
            "/api/messaging/telegram/onboarding/fixture/apply?profile=research",
        ),
        (
            Method::DELETE,
            "/api/messaging/telegram/onboarding/fixture?profile=research",
        ),
        (
            Method::POST,
            "/api/messaging/whatsapp/onboarding/start?profile=research",
        ),
        (
            Method::GET,
            "/api/messaging/whatsapp/onboarding/fixture?profile=research",
        ),
        (
            Method::POST,
            "/api/messaging/whatsapp/onboarding/fixture/apply?profile=research",
        ),
        (
            Method::DELETE,
            "/api/messaging/whatsapp/onboarding/fixture?profile=research",
        ),
        (Method::GET, "/api/actions/fixture/status?lines=200"),
        (Method::GET, "/api/dashboard/plugins?profile=research"),
        (
            Method::GET,
            "/api/dashboard/plugins/rescan?profile=research",
        ),
        (Method::GET, "/api/dashboard/plugins/hub?profile=research"),
        (
            Method::GET,
            "/api/dashboard/plugins/catalog?profile=research",
        ),
        (
            Method::POST,
            "/api/dashboard/agent-plugins/install?profile=research",
        ),
        (
            Method::POST,
            "/api/dashboard/agent-plugins/fixture/enable?profile=research",
        ),
        (
            Method::POST,
            "/api/dashboard/agent-plugins/fixture/disable?profile=research",
        ),
        (
            Method::POST,
            "/api/dashboard/agent-plugins/fixture/update?profile=research",
        ),
        (
            Method::DELETE,
            "/api/dashboard/agent-plugins/fixture?profile=research",
        ),
        (
            Method::PUT,
            "/api/dashboard/plugin-providers?profile=research",
        ),
        (
            Method::POST,
            "/api/dashboard/plugins/fixture/visibility?profile=research",
        ),
        (Method::GET, "/api/dashboard/themes?profile=research"),
        (Method::PUT, "/api/dashboard/theme?profile=research"),
        (Method::GET, "/api/dashboard/font?profile=research"),
        (Method::PUT, "/api/dashboard/font?profile=research"),
        (Method::GET, "/api/mcp/servers?profile=research"),
        (Method::POST, "/api/mcp/servers?profile=research"),
        (
            Method::POST,
            "/api/mcp/servers/fixture/auth?profile=research",
        ),
        (Method::GET, "/api/mcp/oauth/flows/fixture?profile=research"),
        (Method::DELETE, "/api/mcp/servers/fixture?profile=research"),
        (
            Method::POST,
            "/api/mcp/servers/fixture/test?profile=research",
        ),
        (
            Method::PUT,
            "/api/mcp/servers/fixture/enabled?profile=research",
        ),
        (Method::GET, "/api/mcp/catalog?profile=research"),
        (Method::POST, "/api/mcp/catalog/install?profile=research"),
        (Method::GET, "/api/pairing?profile=research"),
        (Method::POST, "/api/pairing/approve?profile=research"),
        (Method::POST, "/api/pairing/revoke?profile=research"),
        (Method::POST, "/api/pairing/clear-pending?profile=research"),
        (Method::GET, "/api/webhooks?profile=research"),
        (Method::POST, "/api/webhooks/enable?profile=research"),
        (Method::POST, "/api/webhooks?profile=research"),
        (Method::DELETE, "/api/webhooks/fixture?profile=research"),
        (
            Method::PUT,
            "/api/webhooks/fixture/enabled?profile=research",
        ),
        (Method::GET, "/api/credentials/pool?profile=research"),
        (Method::POST, "/api/credentials/pool?profile=research"),
        (
            Method::DELETE,
            "/api/credentials/pool/fixture/fixture?profile=research",
        ),
        (Method::GET, "/api/memory?profile=research"),
        (
            Method::GET,
            "/api/memory/providers/fixture/config?profile=research",
        ),
        (
            Method::PUT,
            "/api/memory/providers/fixture/config?profile=research",
        ),
        (
            Method::POST,
            "/api/memory/providers/fixture/setup?profile=research",
        ),
        (Method::PUT, "/api/memory/provider?profile=research"),
        (Method::POST, "/api/memory/reset?profile=research"),
        (Method::POST, "/api/ops/doctor?profile=research"),
        (Method::POST, "/api/ops/security-audit?profile=research"),
        (Method::POST, "/api/ops/backup?profile=research"),
        (
            Method::GET,
            "/api/ops/backup/download?archive=fixture&profile=research",
        ),
        (Method::POST, "/api/ops/import?profile=research"),
        (Method::POST, "/api/ops/import-upload?profile=research"),
        (Method::GET, "/api/ops/hooks?profile=research"),
        (Method::POST, "/api/ops/hooks?profile=research"),
        (Method::DELETE, "/api/ops/hooks?profile=research"),
        (Method::GET, "/api/system/stats"),
        (Method::GET, "/api/curator?profile=research"),
        (Method::PUT, "/api/curator/paused?profile=research"),
        (Method::POST, "/api/curator/run?profile=research"),
        (Method::POST, "/api/ops/prompt-size?profile=research"),
        (Method::POST, "/api/ops/dump?profile=research"),
        (Method::POST, "/api/ops/config-migrate?profile=research"),
        (Method::POST, "/api/ops/debug-share?profile=research"),
        (Method::GET, "/api/ops/checkpoints?profile=research"),
        (Method::POST, "/api/ops/checkpoints/prune?profile=research"),
        (Method::POST, "/api/skills/hub/install?profile=research"),
        (Method::POST, "/api/skills/hub/uninstall?profile=research"),
        (Method::POST, "/api/skills/hub/update?profile=research"),
        (
            Method::GET,
            "/api/skills/hub/search?q=fixture&source=all&limit=20&profile=research",
        ),
        (Method::GET, "/api/skills/hub/sources?profile=research"),
        (
            Method::GET,
            "/api/skills/hub/preview?identifier=fixture&profile=research",
        ),
        (
            Method::GET,
            "/api/skills/hub/scan?identifier=fixture&profile=research",
        ),
    ] {
        let (_, owner) = dashboard_request_url(8765, &method, path)
            .unwrap_or_else(|_| panic!("locked SDK request rejected: {method} {path}"));
        assert_eq!(owner, "core-api", "{method} {path}");
    }
}

#[test]
fn dashboard_sdk_request_cannot_cross_its_owner_profile() {
    let (own, _) = dashboard_request_url(8765, &Method::PUT, "/api/config?profile=research")
        .expect("allowed config route");
    assert!(request_profile_is_bound(
        &own,
        &json!({"body": {"profile": "research"}}),
        "research"
    ));
    let (other, _) = dashboard_request_url(8765, &Method::GET, "/api/config?profile=other")
        .expect("route shape remains valid");
    assert!(!request_profile_is_bound(&other, &json!({}), "research"));
    assert!(!request_profile_is_bound(
        &own,
        &json!({"body": {"profile": "other"}}),
        "research"
    ));
    let (missing, _) = dashboard_request_url(8765, &Method::GET, "/api/config")
        .expect("route shape remains valid");
    assert!(!request_profile_is_bound(&missing, &json!({}), "research"));
    let (global, _) =
        dashboard_request_url(8765, &Method::GET, "/api/profiles").expect("global route");
    assert!(request_profile_is_bound(&global, &json!({}), "research"));
}
