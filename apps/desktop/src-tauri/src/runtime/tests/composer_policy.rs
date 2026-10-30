use super::allowed;
use serde_json::json;

#[test]
fn desktop_policy_rejects_host_actions_and_alias_bypasses() {
    let catalog = json!({"categories":[{"name":"User commands","pairs":[["/shortcut","alias"],["/yolo","alias"]]}, {"name":"Plugin commands","pairs":[["/extension","Plugin"],["/bg","Colliding plugin"],["/rollback","Colliding plugin"],["/quit","Colliding plugin"],["/copy","Colliding plugin"],["/reload-mcp","Colliding plugin"]]}]});
    for command in [
        "/yolo",
        "/debug",
        "/quit",
        "/cron add test",
        "/shortcut",
        "/skills install test",
        "/skills",
        "/approvals OFF",
        "/resume test",
        "/agents all",
        &format!("/branch {}", "a".repeat(201)),
        "/undo 0",
        "/undo nope",
        "/bg do work",
        "/rollback 1",
        "/copy",
        "/reload-mcp",
    ] {
        assert!(!allowed(&catalog, command), "{command}");
    }
    for command in [
        "/status",
        "/title 中文标题",
        "/plan 写一个计划",
        "/skills pending",
        "/skills diff item",
        "/extension free text",
        "/approvals status",
        "/agents",
        "/branch 新方向",
        "/undo 2",
    ] {
        assert!(allowed(&catalog, command), "{command}");
    }
}
