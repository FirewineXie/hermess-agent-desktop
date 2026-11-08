use super::*;

fn key(connection: &str, generation: u64) -> Key {
    Key {
        connection: connection.into(),
        session: "session".into(),
        generation,
    }
}
fn stop() -> Stop {
    Stop::Codex(mpsc::channel(1).0)
}

#[test]
fn banner_survives_tool_gaps_and_waits_for_outstanding_input() {
    let mut inner = Inner::default();
    let key = key("codex-run", 1);
    inner.start(key.clone(), "click", stop());
    inner.settle(&key, Some("click"), false);
    assert_eq!(
        inner.status().phase,
        Phase::Active,
        "thinking between actions is still computer use"
    );
    inner.start(key.clone(), "typing", stop());
    inner.settle(&key, None, true);
    assert_eq!(
        inner.status().phase,
        Phase::Active,
        "turn terminal alone cannot release live input"
    );
    inner.settle(&key, Some("typing"), false);
    assert_eq!(inner.status().phase, Phase::Idle);
}

#[test]
fn duplicate_and_delayed_events_do_not_release_other_runs() {
    let mut inner = Inner::default();
    let first = key("gateway", 1);
    let second = key("gateway", 2);
    let codex = key("codex", 0);
    inner.start(first.clone(), "same-id", stop());
    inner.start(first.clone(), "same-id", stop());
    inner.start(second.clone(), "same-id", stop());
    inner.start(codex.clone(), "same-id", stop());
    inner.settle(&first, Some("same-id"), true);
    assert_eq!(inner.operations.len(), 2);
    inner.settle(&first, Some("same-id"), true);
    assert_eq!(inner.operations.len(), 2);
    inner.settle(&second, Some("same-id"), true);
    assert_eq!(inner.operations.len(), 1);
    assert!(inner.operations.contains_key(&codex));
}

#[test]
fn uncertainty_wins_over_a_successful_stop_in_another_engine() {
    let mut inner = Inner::default();
    let first = key("gateway", 1);
    let second = key("codex", 0);
    inner.start(first.clone(), "one", stop());
    inner.start(second.clone(), "two", stop());
    inner.operations.get_mut(&first).unwrap().phase = Phase::Unknown;
    inner.operations.get_mut(&second).unwrap().phase = Phase::Stopping;
    assert_eq!(inner.status().phase, Phase::Unknown);
    inner.settle(&second, Some("two"), true);
    assert_eq!(inner.status().phase, Phase::Unknown);
}
