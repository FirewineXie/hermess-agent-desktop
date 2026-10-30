use super::{list_output, parse, queued, QueueAction};
use serde_json::json;

#[test]
fn parses_explicit_queue_actions() {
    assert!(matches!(parse(""), Some(QueueAction::List)));
    assert!(matches!(parse("list"), Some(QueueAction::List)));
    assert!(matches!(
        parse("add next task"),
        Some(QueueAction::Add("next task"))
    ));
    assert!(matches!(
        parse("edit 2 revised task"),
        Some(QueueAction::Edit(2, "revised task"))
    ));
    assert!(matches!(parse("rm 2"), Some(QueueAction::Remove(2))));
    assert!(matches!(parse("clear"), Some(QueueAction::Clear)));
    assert!(matches!(parse("move 1 2"), Some(QueueAction::Move)));
    assert!(parse("rm 0").is_none());
    assert!(parse("edit 1").is_none());
    assert!(parse("add ").is_none());
}

#[test]
fn lists_only_queued_admissions_in_sequence() {
    let snapshot = json!({"pending": [
        {"status": "started", "admission_id": "active", "sequence": 1, "text": "running"},
        {"status": "queued", "admission_id": "second", "sequence": 3, "text": "later", "controls": ["replace"]},
        {"status": "queued", "admission_id": "hidden", "sequence": 4, "text": "automation", "controls": []},
        {"status": "queued", "admission_id": "first", "sequence": 2, "text": "earlier", "controls": ["replace"]}
    ]});
    let rows = queued(&snapshot);
    assert_eq!(rows.len(), 2);
    assert_eq!(
        list_output(&rows),
        "当前会话有 2 条可管理的排队请求：\n1. earlier\n2. later"
    );
}
