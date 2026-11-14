use super::GatewayEvent;
use serde::Serialize;

pub(super) enum NoticeSource {
    Local,
    Remote(String),
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GatewayNotice<'a> {
    gateway_id: Option<&'a str>,
    id: String,
    text: Option<String>,
}

impl NoticeSource {
    pub(super) fn project<'a>(&'a self, event: &GatewayEvent) -> Option<GatewayNotice<'a>> {
        let session = event.session_id.as_deref().filter(|id| !id.is_empty())?;
        let (category, field) = match event.kind.as_str() {
            "notification.show" | "notification.clear" => ("notice", "key"),
            "background.complete" => ("task", "task_id"),
            _ => return None,
        };
        let field_value = |field| {
            event
                .payload
                .get(field)?
                .as_str()
                .filter(|key| !key.is_empty())
        };
        let key = match event.kind.as_str() {
            "notification.show" => field_value(field).or_else(|| field_value("id")),
            _ => field_value(field),
        };
        let identity = match (key, event.kind.as_str(), event.seq) {
            (Some(key), _, _) if key.len() <= 512 => serde_json::json!(key),
            (None, "notification.show", Some(seq)) => serde_json::json!(seq),
            _ => return None,
        };
        if session.len() > 512 {
            return None;
        }
        let text = if event.kind == "notification.clear" {
            None
        } else {
            let body = event.payload.get("text")?.as_str()?.trim();
            if body.is_empty() {
                return None;
            }
            Some(body.chars().take(300).collect())
        };
        Some(GatewayNotice {
            gateway_id: match self {
                Self::Local => None,
                Self::Remote(id) => Some(id),
            },
            id: serde_json::json!([session, category, identity]).to_string(),
            text,
        })
    }
}

#[cfg(test)]
#[path = "../tests/gateway_notices.rs"]
mod tests;
