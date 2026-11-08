//! Installation-local auto-unlock storage; this is not a boundary against the same OS user.
use crate::{
    errors::DesktopFailure,
    paths::{filesystem_path, CanonicalizePlain},
};
use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use std::{fs, io::Write, path::Path};

pub(super) fn private_directory(path: &Path) -> Result<(), DesktopFailure> {
    fs::create_dir_all(filesystem_path(path)).map_err(|_| DesktopFailure::operation_failed())?;
    let metadata = fs::symlink_metadata(filesystem_path(path))
        .map_err(|_| DesktopFailure::operation_failed())?;
    if metadata.file_type().is_symlink() {
        return Err(DesktopFailure::invalid_input());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(DesktopFailure::invalid_input());
        }
        protect_windows(path)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(filesystem_path(path), fs::Permissions::from_mode(0o700))
            .map_err(|_| DesktopFailure::operation_failed())?;
    }
    Ok(())
}

#[cfg(windows)]
fn protect_windows(path: &Path) -> Result<(), DesktopFailure> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW, SetFileSecurityW,
            DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
        },
    };
    // Protected DACL: only the owner and SYSTEM; children inherit these rights.
    let sddl: Vec<u16> = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut descriptor = ptr::null_mut();
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(DesktopFailure::operation_failed());
    }
    let wide: Vec<u16> = filesystem_path(path)
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let success = unsafe {
        SetFileSecurityW(
            wide.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        )
    };
    unsafe {
        LocalFree(descriptor);
    }
    if success == 0 {
        return Err(DesktopFailure::operation_failed());
    }
    Ok(())
}

fn master(directory: &Path, create: bool) -> Result<[u8; 32], DesktopFailure> {
    private_directory(directory)?;
    let path = directory.join("master.key");
    if create && !filesystem_path(&path).exists() {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(filesystem_path(&path))
            .map_err(|_| DesktopFailure::operation_failed())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| DesktopFailure::operation_failed())?;
    }
    let canonical = path
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let root = directory
        .canonicalize_plain()
        .map_err(|_| DesktopFailure::operation_failed())?;
    if canonical.parent() != Some(root.as_path()) {
        return Err(DesktopFailure::invalid_input());
    }
    let bytes = fs::read(filesystem_path(&path)).map_err(|_| DesktopFailure::operation_failed())?;
    bytes
        .try_into()
        .map_err(|_| DesktopFailure::operation_failed())
}

pub(super) fn encrypt(
    directory: &Path,
    plaintext: &[u8],
    first_save: bool,
) -> Result<Vec<u8>, DesktopFailure> {
    let key = master(directory, first_save)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| DesktopFailure::operation_failed())?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| DesktopFailure::operation_failed())?;
    let mut result = b"HCP1".to_vec();
    result.extend_from_slice(&nonce);
    result.extend(encrypted);
    Ok(result)
}
pub(super) fn decrypt(directory: &Path, bytes: &[u8]) -> Result<Vec<u8>, DesktopFailure> {
    if bytes.len() < 32 || &bytes[..4] != b"HCP1" {
        return Err(DesktopFailure::invalid_input());
    }
    let key = master(directory, false)?;
    Aes256Gcm::new_from_slice(&key)
        .map_err(|_| DesktopFailure::operation_failed())?
        .decrypt(Nonce::from_slice(&bytes[4..16]), &bytes[16..])
        .map_err(|_| DesktopFailure::operation_failed())
}

#[cfg(test)]
#[path = "tests/coding_vault.rs"]
mod tests;
