use super::{parse_range, response_error, ByteRange, MAX_CHUNK};
use tauri::http::StatusCode;

#[test]
fn audio_video_ranges_support_open_suffix_and_bound_each_allocation() {
    assert_eq!(
        parse_range("bytes=2-5", 10).unwrap(),
        ByteRange { start: 2, end: 5 }
    );
    assert_eq!(
        parse_range("bytes=5-", 10).unwrap(),
        ByteRange { start: 5, end: 9 }
    );
    assert_eq!(
        parse_range("bytes=-3", 10).unwrap(),
        ByteRange { start: 7, end: 9 }
    );
    assert_eq!(
        parse_range("bytes=0-999999999", 100_000_000).unwrap().end,
        MAX_CHUNK - 1
    );
    for value in [
        "bytes=10-",
        "bytes=5-2",
        "bytes=-0",
        "bytes=0-1,4-5",
        "bytes=a-b",
        "items=0-1",
    ] {
        assert!(parse_range(value, 10).is_err(), "{value}");
    }
    assert!(parse_range("bytes=0-", 0).is_err());
}

#[test]
fn invalid_range_response_reports_real_total_without_source_path() {
    let response = response_error(StatusCode::RANGE_NOT_SATISFIABLE, Some(12));
    assert_eq!(response.headers()["content-range"], "bytes */12");
    assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn local_playback_reads_only_requested_bytes_and_rejects_changed_file() {
    let path =
        std::env::temp_dir().join(format!("hermess-media-range-{}.mp4", uuid::Uuid::new_v4()));
    std::fs::write(&path, b"0123456789").unwrap();
    let source = super::MediaSource::Local(path.clone());
    assert_eq!(
        super::read_source(&source, Some(10), Some(&ByteRange { start: 3, end: 6 }))
            .await
            .unwrap(),
        b"3456"
    );
    assert_eq!(
        super::read_source(&source, Some(10), None).await.unwrap(),
        b"0123456789"
    );
    std::fs::write(&path, b"short").unwrap();
    assert!(
        super::read_source(&source, Some(10), Some(&ByteRange { start: 0, end: 2 }))
            .await
            .is_err()
    );
    std::fs::remove_file(path).unwrap();
}
