use super::failure;
use crate::{diagnostics::log_client_event, errors::DesktopFailure, paths::filesystem_path};
use chrono::{Datelike, Days, Utc};
use rcgen::{date_time_ymd, CertificateParams, DnType, ExtendedKeyUsagePurpose, KeyPair};
use std::{fs, io::Write, path::Path};
use tempfile::{Builder, TempDir};

pub(super) fn generate(parent: &Path, host: &str) -> Result<TempDir, DesktopFailure> {
    let generate = || -> Result<TempDir, &'static str> {
        let mut params = CertificateParams::new(vec![host.to_owned()])
            .map_err(|_| "invalid_certificate_host")?;
        params
            .distinguished_name
            .push(DnType::CommonName, "Hermess Web Access");
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        let today = Utc::now().date_naive();
        let start = today - Days::new(1);
        let end = today + Days::new(365);
        params.not_before = date_time_ymd(start.year(), start.month() as u8, start.day() as u8);
        params.not_after = date_time_ymd(end.year(), end.month() as u8, end.day() as u8);
        let key = KeyPair::generate().map_err(|_| "key_generation")?;
        let cert = params
            .self_signed(&key)
            .map_err(|_| "certificate_signing")?;

        let parent = filesystem_path(parent);
        fs::create_dir_all(&parent).map_err(|_| "certificate_directory")?;
        let mut builder = Builder::new();
        builder.prefix("web-access-cert-");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(fs::Permissions::from_mode(0o700));
        }
        let directory = builder
            .tempdir_in(parent)
            .map_err(|_| "certificate_directory")?;
        fs::write(directory.path().join("cert.pem"), cert.pem())
            .map_err(|_| "certificate_write")?;
        let mut key_file =
            tempfile::NamedTempFile::new_in(directory.path()).map_err(|_| "key_create")?;
        key_file
            .write_all(key.serialize_pem().as_bytes())
            .map_err(|_| "key_write")?;
        key_file
            .persist(directory.path().join("key.pem"))
            .map_err(|_| "key_persist")?;
        Ok(directory)
    };
    generate().map_err(|reason| {
        log_client_event(&format!(
            "ERROR web_access_certificate_generation_failed reason={reason}"
        ));
        failure("web_access_tls")
    })
}
