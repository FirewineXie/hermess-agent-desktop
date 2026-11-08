use crate::errors::DesktopFailure;
use serde_json::Value;

pub(super) fn validate(command: &Value) -> Result<(), DesktopFailure> {
    let valid = match command["type"].as_str() {
        Some("goal") => match command["action"].as_str() {
            Some("get" | "pause" | "resume" | "clear") => true,
            Some("set" | "update") => {
                command["objective"]
                    .as_str()
                    .is_some_and(|text| !text.trim().is_empty() && text.chars().count() <= 8192)
                    && command.get("token_budget").is_none_or(|budget| {
                        budget
                            .as_u64()
                            .is_some_and(|budget| budget > 0 && budget <= 9_007_199_254_740_991)
                    })
            }
            _ => false,
        },
        Some("plan") => {
            matches!(command["mode"].as_str(), Some("plan" | "default"))
                && command.get("prompt").is_none_or(|prompt| {
                    prompt.as_str().is_some_and(|text| text.len() <= 64 * 1024)
                })
        }
        Some("compact") => true,
        Some("review") => match command["target"]["type"].as_str() {
            Some("uncommittedChanges") => true,
            Some("baseBranch") => command["target"]["branch"]
                .as_str()
                .is_some_and(|text| !text.trim().is_empty() && text.len() <= 1024),
            Some("commit") => command["target"]["sha"].as_str().is_some_and(|text| {
                (4..=64).contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_hexdigit())
            }),
            Some("custom") => command["target"]["instructions"]
                .as_str()
                .is_some_and(|text| !text.trim().is_empty() && text.len() <= 8192),
            _ => false,
        },
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(DesktopFailure::invalid_input())
    }
}

pub(super) fn display(command: &Value) -> String {
    match command["type"].as_str().unwrap_or("") {
        "review" => {
            let target = &command["target"];
            match target["type"].as_str().unwrap_or("") {
                "baseBranch" => {
                    format!("/review --base {}", target["branch"].as_str().unwrap_or(""))
                }
                "commit" => format!("/review --commit {}", target["sha"].as_str().unwrap_or("")),
                "custom" => format!(
                    "/review --custom {}",
                    target["instructions"].as_str().unwrap_or("")
                ),
                _ => "/review".into(),
            }
        }
        "goal" if command["action"] == "set" => format!(
            "/goal {}{}",
            command["token_budget"]
                .as_u64()
                .map(|budget| format!("--budget {budget} "))
                .unwrap_or_default(),
            command["objective"].as_str().unwrap_or("")
        ),
        "goal" => format!("/goal {}", command["action"].as_str().unwrap_or("get")),
        _ => "/compact".into(),
    }
}
