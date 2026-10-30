use super::{parse_argument, preview, UndoArgument};
use serde_json::json;

#[test]
fn preview_selects_the_oldest_turn_to_remove_and_ignores_archived_scaffolding() {
    let snapshot = json!({"messages": [
        {"role":"user","row_id":1,"content":"old","archived":true},
        {"role":"user","row_id":2,"content":"q1"},
        {"role":"assistant","row_id":3,"content":"a1"},
        {"role":"user","row_id":4,"content":"handoff","display_kind":"hidden"},
        {"role":"user","row_id":5,"content":"q2","display_kind":"steer"},
        {"role":"assistant","row_id":6,"content":"a2"},
        {"role":"user","row_id":7,"content":"q3"},
    ]});
    assert_eq!(preview(&snapshot, 2), Some((5, "q2；q3".into())));
    assert_eq!(preview(&snapshot, 4), None);
}

#[test]
fn confirmation_argument_requires_a_uuid_and_matching_turn_count() {
    assert!(matches!(parse_argument(""), Some(UndoArgument::Preview(1))));
    assert!(matches!(
        parse_argument("2"),
        Some(UndoArgument::Preview(2))
    ));
    assert!(matches!(parse_argument("0"), None));
    assert!(matches!(parse_argument("2 --confirm bad"), None));
}
