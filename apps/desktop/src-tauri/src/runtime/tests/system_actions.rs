use super::{
    action_args, actions_conflict, backup_args, copy_backup, debug_share_body, export_destination,
    restore_args, restore_source, tail, toolset_setup_args, valid_archive,
};
use crate::paths::CanonicalizePlain;
use std::fs;
use std::io::Write;
use std::path::Path;
use zip::{write::SimpleFileOptions, ZipWriter};

#[test]
fn actions_accept_only_locked_commands() {
    assert_eq!(
        action_args("worker_beta", "doctor").unwrap(),
        ["-p", "worker_beta", "doctor"]
    );
    assert_eq!(
        action_args("default", "security-audit").unwrap(),
        ["-p", "default", "security", "audit"]
    );
    assert_eq!(
        action_args("worker_beta", "checkpoints-prune").unwrap(),
        ["-p", "worker_beta", "checkpoints", "prune", "--force"]
    );
    assert_eq!(
        backup_args("worker_beta", Path::new("backup.zip")).unwrap(),
        ["-p", "worker_beta", "backup", "-o", "backup.zip"]
    );
    assert_eq!(
        restore_args("default", Path::new("backup.zip")).unwrap(),
        ["-p", "default", "import", "backup.zip", "--force"]
    );
    assert!(restore_args("worker_beta", Path::new("backup.zip")).is_err());
    assert_eq!(
        action_args("default", "prompt-size").unwrap(),
        ["-p", "default", "prompt-size"]
    );
    assert_eq!(
        action_args("worker_beta", "dump").unwrap(),
        ["-p", "worker_beta", "dump"]
    );
    assert_eq!(
        action_args("worker_beta", "config-migrate").unwrap(),
        ["-p", "worker_beta", "config", "migrate"]
    );
    assert_eq!(
        action_args("worker_beta", "curator-run").unwrap(),
        ["-p", "worker_beta", "curator", "run"]
    );
    assert_eq!(
        toolset_setup_args("worker_beta", "ddgs").unwrap(),
        ["-p", "worker_beta", "tools", "post-setup", "ddgs"]
    );
    assert_eq!(
        action_args("worker_beta", "memory-provider-setup").unwrap(),
        Vec::<String>::new()
    );
    assert!(action_args("default", "doctor --fix").is_err());
    assert!(action_args("default", "security-fix").is_err());
    assert!(actions_conflict("backup", "restore"));
    assert!(actions_conflict("restore", "backup"));
    assert!(actions_conflict("doctor", "doctor"));
    assert!(!actions_conflict("doctor", "backup"));
    assert_eq!(
        debug_share_body(&serde_json::json!({"redact": true, "lines": 200})).unwrap(),
        serde_json::json!({"redact": true, "lines": 200})
    );
    assert!(debug_share_body(&serde_json::json!({"lines": 0})).is_err());
}

#[test]
#[ignore]
fn print_production_toolset_setup_args() {
    println!(
        "TOOLSET_SETUP={}",
        serde_json::json!({"args": toolset_setup_args("worker_beta", "invalid_key").unwrap()})
    );
}

#[test]
fn backup_export_requires_valid_archive_and_new_zip_destination() {
    let base = std::env::temp_dir().join(format!("hermess-backup-export-{}", uuid::Uuid::new_v4()));
    let backups = base.join("hermes-home").join("backups");
    fs::create_dir_all(&backups).unwrap();
    let source = backups.join("backup.zip");
    let mut writer = ZipWriter::new(fs::File::create(&source).unwrap());
    writer
        .start_file("config.yaml", SimpleFileOptions::default())
        .unwrap();
    writer.write_all(b"model: test\n").unwrap();
    writer.finish().unwrap();
    let destination = base.join("download.zip");
    assert!(valid_archive(&source));
    assert_eq!(
        restore_source(source.to_str().unwrap()).unwrap(),
        source.canonicalize_plain().unwrap()
    );
    assert_eq!(
        export_destination(destination.to_str().unwrap()).unwrap(),
        destination
    );
    assert_eq!(
        copy_backup(&base, &source, &destination).unwrap(),
        fs::metadata(&source).unwrap().len()
    );
    assert_eq!(fs::read(&destination).unwrap(), fs::read(&source).unwrap());
    assert!(copy_backup(&base, &source, &destination).is_err());
    fs::remove_file(&destination).unwrap();
    fs::write(&source, b"invalid zip").unwrap();
    assert!(!valid_archive(&source));
    assert!(restore_source(source.to_str().unwrap()).is_err());
    assert!(copy_backup(&base, &source, &destination).is_err());
    assert!(export_destination(base.join("download.txt").to_str().unwrap()).is_err());
    fs::remove_file(&source).unwrap();
    fs::remove_dir(&backups).unwrap();
    fs::remove_dir(base.join("hermes-home")).unwrap();
    fs::remove_dir(base).unwrap();
}

#[test]
fn action_log_tail_is_bounded() {
    let path = std::env::temp_dir().join(format!(
        "hermess-system-action-{}.log",
        uuid::Uuid::new_v4()
    ));
    let mut file = fs::File::create(&path).unwrap();
    for index in 0..450 {
        writeln!(file, "line {index}").unwrap();
    }
    let lines = tail(&path).unwrap();
    fs::remove_file(path).unwrap();
    assert_eq!(lines.len(), 400);
    assert_eq!(lines.first().unwrap(), "line 50");
    assert_eq!(lines.last().unwrap(), "line 449");
}

#[test]
#[ignore = "locked CLI receiver test consumes these production arguments"]
fn print_production_system_action_args() {
    for profile in ["default", "worker_beta"] {
        for action in [
            "doctor",
            "security-audit",
            "checkpoints-prune",
            "prompt-size",
            "dump",
            "config-migrate",
        ] {
            let args = action_args(profile, action).unwrap();
            println!(
                "SYSTEM_ACTION_CLI={}",
                serde_json::json!({"profile":profile,"action":action,"args":args})
            );
        }
    }
    if let Ok(directory) = std::env::var("SYSTEM_ACTION_BACKUP_DIR") {
        for profile in ["default", "worker_beta"] {
            let output = Path::new(&directory).join(format!("hermess-backup-{profile}.zip"));
            println!(
                "SYSTEM_ACTION_CLI={}",
                serde_json::json!({"profile":profile,
                "action":"backup", "args":backup_args(profile, &output).unwrap()})
            );
        }
        let restore = Path::new(&directory).join("restore-source.zip");
        println!(
            "SYSTEM_ACTION_CLI={}",
            serde_json::json!({"profile":"default",
            "action":"restore", "args":restore_args("default", &restore).unwrap()})
        );
    }
}

#[test]
#[ignore = "locked Dashboard receiver test consumes this production request"]
fn print_production_debug_share_shape() {
    println!(
        "DEBUG_SHARE_SHAPE={}",
        serde_json::json!({
            "method":"POST", "path":"/api/ops/debug-share",
            "body":debug_share_body(&serde_json::json!({"redact":true,"lines":200})).unwrap()
        })
    );
}
