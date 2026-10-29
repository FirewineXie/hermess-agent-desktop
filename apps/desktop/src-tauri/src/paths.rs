#[cfg(windows)]
use std::{
    ffi::OsString,
    os::windows::ffi::{OsStrExt, OsStringExt},
};
use std::{
    io,
    path::{Path, PathBuf},
};

/// Product paths use ordinary Win32 spelling. Rust's Windows canonicalize adds
/// an extended-length prefix, so remove it before the path leaves this boundary.
pub(crate) fn plain_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let mut units: Vec<u16> = path.as_os_str().encode_wide().collect();
        for unit in &mut units {
            if *unit == b'/' as u16 {
                *unit = b'\\' as u16;
            }
        }
        let prefix = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
        if units.starts_with(&prefix) {
            let rest = &units[prefix.len()..];
            let unc = [b'U' as u16, b'N' as u16, b'C' as u16, b'\\' as u16];
            if rest.starts_with(&unc) {
                units = [vec![b'\\' as u16, b'\\' as u16], rest[4..].to_vec()].concat();
            } else if rest.len() >= 3
                && rest[0] <= 0x7f
                && (rest[0] as u8).is_ascii_alphabetic()
                && rest[1] == b':' as u16
                && rest[2] == b'\\' as u16
            {
                units = rest.to_vec();
            }
        }
        return PathBuf::from(OsString::from_wide(&units));
    }
    #[cfg(not(windows))]
    path.to_path_buf()
}

/// Use extended spelling only for deep Windows filesystem operations. Product
/// state, process arguments and returned paths keep the ordinary spelling.
pub(crate) fn filesystem_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let plain = plain_path(path);
        if !plain.is_absolute() {
            return plain;
        }
        let units: Vec<u16> = plain.as_os_str().encode_wide().collect();
        let has_dot_segment = units
            .split(|unit| *unit == b'\\' as u16)
            .any(|part| part == [b'.' as u16] || part == [b'.' as u16, b'.' as u16]);
        if units.len() < 240 || has_dot_segment {
            return plain;
        }
        let mut extended = if units.starts_with(&[b'\\' as u16, b'\\' as u16]) {
            r"\\?\UNC\".encode_utf16().collect::<Vec<_>>()
        } else if units.len() >= 3
            && units[0] <= 0x7f
            && (units[0] as u8).is_ascii_alphabetic()
            && units[1] == b':' as u16
            && units[2] == b'\\' as u16
        {
            r"\\?\".encode_utf16().collect::<Vec<_>>()
        } else {
            return plain;
        };
        if units.starts_with(&[b'\\' as u16, b'\\' as u16]) {
            extended.extend_from_slice(&units[2..]);
        } else {
            extended.extend_from_slice(&units);
        }
        return PathBuf::from(OsString::from_wide(&extended));
    }
    #[cfg(not(windows))]
    path.to_path_buf()
}

pub(crate) trait CanonicalizePlain {
    fn canonicalize_plain(&self) -> io::Result<PathBuf>;
}

impl CanonicalizePlain for Path {
    fn canonicalize_plain(&self) -> io::Result<PathBuf> {
        std::fs::canonicalize(self).map(|path| plain_path(&path))
    }
}

#[cfg(test)]
#[path = "tests/paths.rs"]
mod tests;
