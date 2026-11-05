use super::hides_on_close;

#[test]
fn main_and_quick_input_hide_but_chat_windows_close() {
    assert!(hides_on_close("main"));
    assert!(hides_on_close("quick-input"));
    assert!(!hides_on_close("chat-one"));
}
