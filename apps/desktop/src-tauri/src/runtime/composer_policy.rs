use serde_json::Value;

pub(super) fn allowed(catalog: &Value, command: &str) -> bool {
    let mut parts = command.splitn(2, char::is_whitespace);
    let name = parts.next().unwrap_or("");
    let arg = parts.next().unwrap_or("").trim();
    let builtin = matches!(
        name,
        "/help"
            | "/status"
            | "/context"
            | "/version"
            | "/whoami"
            | "/usage"
            | "/insights"
            | "/profile"
            | "/diff"
            | "/memory"
            | "/kanban"
            | "/topup"
            | "/suggestions"
            | "/bundles"
            | "/skills"
            | "/title"
            | "/goal"
            | "/subgoal"
            | "/loop"
            | "/heartbeat"
            | "/review"
            | "/refine"
            | "/curator"
            | "/login"
            | "/autoprune"
            | "/plan"
            | "/learn"
            | "/init"
            | "/moa"
            | "/blueprint"
            | "/egress"
            | "/reasoning"
            | "/approvals"
            | "/codex-runtime"
            | "/fast"
            | "/personality"
            | "/approve"
            | "/deny"
    );
    if builtin {
        if name == "/skills" {
            return matches!(
                arg.split_whitespace().next(),
                Some("pending" | "approve" | "reject" | "diff" | "approval")
            );
        }
        return name != "/approvals" || !arg.eq_ignore_ascii_case("off");
    }
    // Only rows registered as plugin commands can extend this policy. A user alias
    // does not expose its resolved target in the catalog, so cannot bypass builtins.
    catalog["categories"].as_array().is_some_and(|categories| {
        categories.iter().any(|category| {
            category["name"] == "Plugin commands"
                && category["pairs"]
                    .as_array()
                    .is_some_and(|pairs| pairs.iter().any(|pair| pair[0].as_str() == Some(name)))
        })
    })
}

#[cfg(test)]
#[path = "tests/composer_policy.rs"]
mod tests;
