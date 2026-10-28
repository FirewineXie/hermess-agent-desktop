use crate::errors::DesktopFailure;
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn secret_key(id: &str, base_url: &str) -> Result<String, DesktopFailure> {
    Uuid::parse_str(id).map_err(|_| DesktopFailure::invalid_input())?;
    let url_hash = Sha256::digest(base_url.as_bytes());
    Ok(format!("HermessAgentDesktop.remote.v1.{id}.{url_hash:x}"))
}

#[cfg(windows)]
mod platform {
    use super::DesktopFailure;
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub(super) fn write(key: &str, token: &str) -> Result<(), DesktopFailure> {
        let mut target = wide(key);
        let mut secret = token.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: secret.len() as u32,
            CredentialBlob: secret.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..CREDENTIALW::default()
        };
        let written = unsafe { CredWriteW(&credential, 0) } != 0;
        secret.fill(0);
        if written {
            Ok(())
        } else {
            Err(DesktopFailure::operation_failed())
        }
    }

    pub(super) fn read(key: &str) -> Result<Option<String>, DesktopFailure> {
        let target = wide(key);
        let mut pointer = std::ptr::null_mut::<CREDENTIALW>();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) } == 0 {
            return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err(DesktopFailure::operation_failed())
            };
        }
        let size = unsafe { (*pointer).CredentialBlobSize as usize };
        let bytes = if size == 0 {
            Vec::new()
        } else if size <= 2048 && !unsafe { (*pointer).CredentialBlob.is_null() } {
            unsafe { std::slice::from_raw_parts((*pointer).CredentialBlob, size).to_vec() }
        } else {
            unsafe { CredFree(pointer.cast()) };
            return Err(DesktopFailure::operation_failed());
        };
        unsafe { CredFree(pointer.cast()) };
        String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| DesktopFailure::operation_failed())
    }

    pub(super) fn delete(key: &str) -> Result<(), DesktopFailure> {
        let target = wide(key);
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0
            || unsafe { GetLastError() } == ERROR_NOT_FOUND
        {
            Ok(())
        } else {
            Err(DesktopFailure::operation_failed())
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::DesktopFailure;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    const SERVICE: &str = "HermessAgentDesktop.remote.v1";
    const ITEM_NOT_FOUND: i32 = -25300;

    pub(super) fn write(key: &str, token: &str) -> Result<(), DesktopFailure> {
        set_generic_password(SERVICE, key, token.as_bytes())
            .map_err(|_| DesktopFailure::operation_failed())
    }

    pub(super) fn read(key: &str) -> Result<Option<String>, DesktopFailure> {
        match get_generic_password(SERVICE, key) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| DesktopFailure::operation_failed()),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
            Err(_) => Err(DesktopFailure::operation_failed()),
        }
    }

    pub(super) fn delete(key: &str) -> Result<(), DesktopFailure> {
        match delete_generic_password(SERVICE, key) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
            Err(_) => Err(DesktopFailure::operation_failed()),
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::DesktopFailure;

    pub(super) fn write(_: &str, _: &str) -> Result<(), DesktopFailure> {
        Err(DesktopFailure::operation_failed())
    }
    pub(super) fn read(_: &str) -> Result<Option<String>, DesktopFailure> {
        Err(DesktopFailure::operation_failed())
    }
    pub(super) fn delete(_: &str) -> Result<(), DesktopFailure> {
        Err(DesktopFailure::operation_failed())
    }
}

pub(super) fn store(id: &str, base_url: &str, token: &str) -> Result<(), DesktopFailure> {
    if token.is_empty()
        || token.len() > 2048
        || !token.is_ascii()
        || token.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        return Err(DesktopFailure::invalid_input());
    }
    platform::write(&secret_key(id, base_url)?, token)
}

pub(super) fn load(id: &str, base_url: &str) -> Result<Option<String>, DesktopFailure> {
    platform::read(&secret_key(id, base_url)?)
}

pub(super) fn remove(id: &str, base_url: &str) -> Result<(), DesktopFailure> {
    platform::delete(&secret_key(id, base_url)?)
}

#[cfg(test)]
#[path = "tests/remote_secret.rs"]
mod tests;
