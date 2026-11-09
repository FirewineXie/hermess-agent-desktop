use super::{history_params, HistoryChange, HistoryOperation};
use serde_json::json;
use uuid::Uuid;

#[test]
#[ignore = "run by the isolated locked Gateway receiver probe"]
fn print_production_gateway_feature_history() {
    for (id, operation) in [
        ("history-branch", HistoryOperation::Branch),
        ("history-rewind", HistoryOperation::Rewind),
    ] {
        let params = history_params(
            "fixture",
            &HistoryChange {
                operation,
                row_id: 1,
                request_id: Uuid::new_v4().to_string(),
                revision: 0,
                generation: 0,
            },
        )
        .unwrap();
        println!(
            "FEATURE_SHAPE={}",
            json!({"id": id, "method": "session.mutate", "params": params})
        );
    }
}
