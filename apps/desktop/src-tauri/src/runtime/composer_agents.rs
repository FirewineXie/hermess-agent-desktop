use serde_json::Value;

pub(super) fn format_roster(roster: &Value) -> String {
    let live = roster["subagents"].as_array();
    let failed = roster["delegations"].as_array();
    let live_count = live.map_or(0, Vec::len);
    let failed_count = failed.map_or(0, Vec::len);
    if live_count + failed_count == 0 {
        return "No live subagents or failed delegations in this session.".into();
    }

    let mut lines = Vec::new();
    if let Some(live) = live.filter(|rows| !rows.is_empty()) {
        lines.push(format!("Live subagents ({live_count}):"));
        for row in live {
            lines.push(format!(
                "• {} · {} · {}",
                field(row, "subagent_id"),
                field(row, "status"),
                field(row, "goal")
            ));
        }
    }
    if let Some(failed) = failed.filter(|rows| !rows.is_empty()) {
        lines.push(format!("Failed delegations ({failed_count}):"));
        for row in failed {
            lines.push(format!(
                "• {} #{} · {} · {}",
                field(row, "delegation_id"),
                row["task_index"].as_u64().unwrap_or(0),
                field(row, "status"),
                field(row, "goal")
            ));
        }
    }
    lines.join("\n")
}

fn field(row: &Value, key: &str) -> String {
    let text = row[key].as_str().unwrap_or("—");
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() {
        "—".into()
    } else {
        clean
    }
}

#[cfg(test)]
#[path = "tests/composer_agents.rs"]
mod tests;
