use crate::{
    errors::DesktopFailure,
    paths::{filesystem_path, CanonicalizePlain},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, io::Read, path::Path};

pub(super) struct Images {
    pub data_urls: Vec<String>,
    pub names: Vec<String>,
}
pub(super) fn prepare(paths: Vec<String>) -> Result<Images, DesktopFailure> {
    if paths.len() > 4 {
        return Err(DesktopFailure::invalid_input());
    }
    let mut result = Images {
        data_urls: vec![],
        names: vec![],
    };
    let mut total = 0usize;
    for (index, path) in paths.into_iter().enumerate() {
        let (bytes, name, declared_mime) = if path.starts_with("data:") {
            let (header, encoded) = path
                .split_once(',')
                .ok_or_else(DesktopFailure::invalid_input)?;
            let mime = header
                .strip_prefix("data:")
                .and_then(|header| header.strip_suffix(";base64"))
                .filter(|mime| {
                    matches!(
                        *mime,
                        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
                    )
                })
                .ok_or_else(DesktopFailure::invalid_input)?;
            if encoded.len() > (20 * 1024 * 1024usize).div_ceil(3) * 4 {
                return Err(DesktopFailure::invalid_input());
            }
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| DesktopFailure::invalid_input())?;
            let extension = mime.strip_prefix("image/").unwrap();
            (
                bytes,
                format!("pasted-image-{}.{extension}", index + 1),
                Some(mime),
            )
        } else {
            if !Path::new(&path).is_absolute() {
                return Err(DesktopFailure::invalid_input());
            }
            let path = Path::new(&path)
                .canonicalize_plain()
                .map_err(|_| DesktopFailure::invalid_input())?;
            let file = fs::File::open(filesystem_path(&path))
                .map_err(|_| DesktopFailure::operation_failed())?;
            let mut bytes = Vec::new();
            file.take(20 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| DesktopFailure::operation_failed())?;
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            (bytes, name, None)
        };
        total += bytes.len();
        if total > 20 * 1024 * 1024 {
            return Err(DesktopFailure::invalid_input());
        }
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            "image/jpeg"
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            "image/gif"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            "image/webp"
        } else {
            return Err(DesktopFailure::invalid_input());
        };
        if declared_mime.is_some_and(|declared| declared != mime) {
            return Err(DesktopFailure::invalid_input());
        }
        result
            .data_urls
            .push(format!("data:{mime};base64,{}", STANDARD.encode(bytes)));
        result.names.push(name);
    }
    Ok(result)
}

#[cfg(test)]
#[path = "tests/coding_images.rs"]
mod tests;
