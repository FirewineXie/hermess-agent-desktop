use crate::errors::DesktopFailure;
use crate::gateway::GatewayRequestError;
use serde_json::{json, Value};
use uuid::Uuid;

use super::profile_scope::ResolvedProfileScope;
use super::BackendState;

pub(super) async fn execute(
    state: &BackendState,
    scope: &ResolvedProfileScope,
    session_id: &str,
    title: &str,
) -> Result<Value, DesktopFailure> {
    if title.chars().count() > 200 {
        return Err(DesktopFailure::invalid_input());
    }
    let _gate = state.4.lock().await;
    // Keep a result-unknown branch request separate from a pending delete of the same parent.
    let key = (
        scope.home.to_string_lossy().into_owned(),
        scope.profile.clone(),
        format!("branch:{session_id}"),
    );
    let pending = state.3.lock().await.get(&key).cloned();
    let retry = pending.is_some();
    let params = if let Some(previous) = pending {
        previous
    } else {
        let snapshot = scope
            .gateway
            .request(
                "session.resume",
                json!({"session_id": session_id, "source": "desktop"}),
            )
            .await?;
        let (Some(revision), Some(generation)) = (
            snapshot["revision"].as_u64(),
            snapshot["execution_generation"].as_u64(),
        ) else {
            return Err(DesktopFailure::conflict());
        };
        let payload = if title.is_empty() {
            json!({})
        } else {
            json!({"title": title})
        };
        let params = json!({
            "session_id": session_id,
            "request_id": Uuid::new_v4().to_string(),
            "expected_revision": revision,
            "expected_generation": generation,
            "operation": "branch",
            "payload": payload,
        });
        state.3.lock().await.insert(key.clone(), params.clone());
        params
    };
    let request_id = params["request_id"].as_str().unwrap_or("").to_owned();
    let log = |stage: &str| {
        let _ = crate::diagnostics::append_client_event(
            &scope.storage,
            &format!(
                "session_branch_{stage} request={request_id} profile={} session={session_id}",
                scope.profile
            ),
        );
    };
    log(if retry { "retry" } else { "start" });
    match scope
        .gateway
        .request_detailed("session.mutate", params)
        .await
    {
        Ok(receipt) => {
            let Some(child) = receipt["branched_session_id"]
                .as_str()
                .filter(|id| !id.is_empty())
            else {
                log("invalid_receipt");
                return Err(DesktopFailure::timeout());
            };
            state.3.lock().await.remove(&key);
            log("completed");
            Ok(json!({"type": "branch", "message": child}))
        }
        Err(GatewayRequestError::Rpc { message, code }) => {
            state.3.lock().await.remove(&key);
            log("refused");
            Err(format!("{message} ({code})").into())
        }
        Err(GatewayRequestError::Transport(_)) => {
            log("result_unknown");
            Err(DesktopFailure::timeout())
        }
    }
}
