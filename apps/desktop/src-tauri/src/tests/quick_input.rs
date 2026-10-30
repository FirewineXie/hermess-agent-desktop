use super::{Inner, Target};

fn target() -> Target {
    Target {
        profile: "writer".into(),
        session_id: "session".into(),
        epoch: "epoch".into(),
        busy: false,
    }
}

#[test]
fn refuses_stale_target_busy_state_and_empty_text() {
    let mut state = Inner {
        target: Some(target()),
        pending: None,
        ..Default::default()
    };
    let mut other = target();
    other.profile = "other".into();
    assert!(state
        .enqueue(uuid::Uuid::new_v4().to_string(), other, "hello".into())
        .is_err());
    let mut busy = target();
    busy.busy = true;
    assert!(state
        .enqueue(uuid::Uuid::new_v4().to_string(), busy, "hello".into())
        .is_err());
    assert!(state
        .enqueue(uuid::Uuid::new_v4().to_string(), target(), "  ".into())
        .is_err());
    let mut epoch = target();
    epoch.epoch = "different".into();
    assert!(state
        .enqueue(uuid::Uuid::new_v4().to_string(), epoch, "hello".into())
        .is_err());
}

#[test]
fn claims_exactly_once_and_blocks_a_second_pending_submission() {
    let mut state = Inner {
        target: Some(target()),
        pending: None,
        ..Default::default()
    };
    let message = state
        .enqueue(uuid::Uuid::new_v4().to_string(), target(), "hello".into())
        .unwrap();
    assert!(state
        .enqueue(
            uuid::Uuid::new_v4().to_string(),
            target(),
            "duplicate".into()
        )
        .is_err());
    assert!(state.claim("wrong-id").is_err());
    assert_eq!(state.claim(&message.request_id).unwrap().text, "hello");
    assert!(state.claim(&message.request_id).is_err());
}

#[test]
fn completed_request_ids_cannot_be_replayed() {
    let mut state = Inner {
        target: Some(target()),
        ..Default::default()
    };
    let id = uuid::Uuid::new_v4().to_string();
    let message = state.enqueue(id.clone(), target(), "hello".into()).unwrap();
    assert_eq!(message.request_id, id);
    state.claim(&id).unwrap();
    state.pending = None;
    assert!(state.enqueue(id, target(), "replayed".into()).is_err());
    assert!(state
        .enqueue("invalid-id".into(), target(), "hello".into())
        .is_err());
}
