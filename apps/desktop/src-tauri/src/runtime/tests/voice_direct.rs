use super::{audio_bytes, provider_url, silence_hallucination, transcription_text};
use serde_json::json;

#[test]
fn provider_paths_keep_base_prefix_and_encode_voice_id() {
    assert_eq!(
        provider_url("https://example.test/v1", &["audio", "transcriptions"])
            .unwrap()
            .as_str(),
        "https://example.test/v1/audio/transcriptions"
    );
    assert_eq!(
        provider_url("https://example.test/v1", &["text-to-speech", "voice/a"])
            .unwrap()
            .as_str(),
        "https://example.test/v1/text-to-speech/voice%2Fa"
    );
    assert!(provider_url("https://example.test/v1?token=secret", &["audio"]).is_err());
}

#[test]
fn direct_transcription_matches_relay_silence_contract() {
    let filter = json!({"hallucination_filter": {
        "phrases": ["thank you"],
        "repeat_regex": "^(?:thank you|thanks|bye|you|ok|okay|the end|[.,!\\s])+$"
    }});
    assert_eq!(
        transcription_text("openai-multipart", br#"{"text":" hello "}"#).unwrap(),
        "hello"
    );
    assert_eq!(
        transcription_text("xai-stt", br#"{"text":" hello "}"#).unwrap(),
        "hello"
    );
    assert!(silence_hallucination("Thank you!", &filter));
    assert!(silence_hallucination("OK. OK.", &filter));
    assert!(!silence_hallucination("Let's continue", &filter));
}

#[test]
fn direct_audio_requires_matching_mime_and_bounded_base64() {
    assert_eq!(
        audio_bytes("data:audio/webm;base64,YWJj", "audio/webm").unwrap(),
        b"abc"
    );
    assert!(audio_bytes("data:audio/mp4;base64,YWJj", "audio/webm").is_err());
    assert!(audio_bytes("data:audio/webm;base64,???", "audio/webm").is_err());
}
