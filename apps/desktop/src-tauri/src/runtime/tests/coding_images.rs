use super::prepare;
use base64::{engine::general_purpose::STANDARD, Engine};

#[test]
fn accepts_paths_and_clipboard_images_and_rejects_invalid_inputs() {
    let root = std::env::temp_dir().join(format!("hermess-images-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let png = b"\x89PNG\r\n\x1a\nfixture";
    let path = root.join("image.png");
    std::fs::write(&path, png).unwrap();
    let data = format!("data:image/png;base64,{}", STANDARD.encode(png));
    let images = prepare(vec![path.to_string_lossy().into_owned(), data.clone()]).unwrap();
    assert_eq!(images.data_urls, [data.clone(), data.clone()]);
    assert_eq!(images.names, ["image.png", "pasted-image-2.png"]);
    for invalid in [
        "relative.png".to_owned(),
        "data:image/png;base64,%%%".to_owned(),
        "data:image/png;base64,".to_owned(),
        data.replace("image/png", "image/jpeg"),
        data.replace("image/png", "image/svg+xml"),
        format!(
            "data:image/png;base64,{}",
            "A".repeat((20 * 1024 * 1024usize).div_ceil(3) * 4 + 4)
        ),
    ] {
        assert!(prepare(vec![invalid]).is_err());
    }
    assert!(prepare(vec![data; 5]).is_err());
    let mut large_png = png.to_vec();
    large_png.resize(11 * 1024 * 1024, 0);
    let large_data = format!("data:image/png;base64,{}", STANDARD.encode(large_png));
    assert!(prepare(vec![large_data.clone(), large_data]).is_err());
    std::fs::remove_dir_all(root).unwrap();
}
