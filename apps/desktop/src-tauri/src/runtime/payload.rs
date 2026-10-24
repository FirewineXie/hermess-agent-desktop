use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

fn expected_runtime_target() -> Result<&'static str, String> {
    if cfg!(all(windows, target_arch = "x86_64")) {
        Ok("win32-x64")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Ok("darwin-x64")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok("darwin-arm64")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok("linux-x64")
    } else {
        Err("当前平台尚无经过验收的内置运行时".into())
    }
}

pub(super) fn validate_payload(payload: &std::path::Path) -> Result<PathBuf, String> {
    let manifest = fs::read(payload.join("manifest.json"))
        .map_err(|_| "发行资源缺少 Hermes 清单".to_string())?;
    let value: Value =
        serde_json::from_slice(&manifest).map_err(|_| "Hermes 清单格式无效".to_string())?;
    let lock: Value =
        serde_json::from_str(include_str!("../../../../../runtime/upstream.lock.json"))
            .map_err(|_| "产品上游锁文件无效".to_string())?;
    let target = expected_runtime_target()?;
    let launcher = if cfg!(windows) {
        "bin/hermes.exe"
    } else {
        "bin/hermes"
    };
    if value.get("schema").and_then(Value::as_u64) != Some(1)
        || value.get("target").and_then(Value::as_str) != Some(target)
        || value.get("repo").and_then(Value::as_str) != Some("hermes-agent")
        || value.get("ref") != lock.get("commit")
        || value
            .pointer("/runtime/commands/hermes")
            .and_then(Value::as_str)
            != Some(launcher)
    {
        return Err("内置运行时与产品锁定版本不匹配".into());
    }
    let launcher = payload.join(launcher);
    let real = launcher
        .canonicalize()
        .map_err(|_| "内置 Hermes 启动器不存在".to_string())?;
    let root = payload
        .canonicalize()
        .map_err(|_| "内置运行时目录不存在".to_string())?;
    if !real.starts_with(root) {
        return Err("内置 Hermes 启动器越过资源目录".into());
    }
    Ok(real)
}

pub(super) fn install_packed_payload(resource: &Path, selected: &Path) -> Result<PathBuf, String> {
    if !selected.is_absolute() {
        return Err("存储位置必须是绝对路径".into());
    }
    fs::create_dir_all(selected).map_err(|_| "无法创建存储位置".to_string())?;
    let root = selected
        .canonicalize()
        .map_err(|_| "无法解析存储位置".to_string())?
        .join("HermessAgentDesktop");
    fs::create_dir_all(root.join("control")).map_err(|_| "无法创建产品控制目录".to_string())?;
    let root = root
        .canonicalize()
        .map_err(|_| "无法解析产品存储目录".to_string())?;
    let install_lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(root.join("control/runtime-install.lock"))
        .map_err(|_| "无法打开运行时安装锁".to_string())?;
    install_lock
        .try_lock()
        .map_err(|_| "运行时正在由另一个实例准备".to_string())?;

    let receipt: Value = serde_json::from_slice(
        &fs::read(resource.join("runtime/receipt.json"))
            .map_err(|_| "离线资源缺少校验清单".to_string())?,
    )
    .map_err(|_| "离线资源校验清单无效".to_string())?;
    let lock: Value =
        serde_json::from_str(include_str!("../../../../../runtime/upstream.lock.json"))
            .map_err(|_| "产品上游锁文件无效".to_string())?;
    let digest = receipt
        .get("archive_sha256")
        .and_then(Value::as_str)
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("离线资源摘要无效")?;
    if receipt.get("schema").and_then(Value::as_u64) != Some(1)
        || receipt.get("target").and_then(Value::as_str) != Some(expected_runtime_target()?)
        || receipt.get("upstream_commit") != lock.get("commit")
    {
        return Err("离线资源与产品锁定版本不匹配".into());
    }
    let archive_path = resource.join("runtime/payload.tar");
    let mut archive_file =
        fs::File::open(&archive_path).map_err(|_| "离线运行时归档不存在".to_string())?;
    if receipt.get("archive_bytes").and_then(Value::as_u64)
        != Some(
            archive_file
                .metadata()
                .map_err(|_| "无法读取运行时归档大小".to_string())?
                .len(),
        )
    {
        return Err("离线运行时归档大小不符".into());
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let count = archive_file
            .read(&mut buffer)
            .map_err(|_| "读取运行时归档失败".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != digest {
        return Err("离线运行时归档摘要不符".into());
    }

    let runtimes = root.join("runtimes");
    fs::create_dir_all(&runtimes).map_err(|_| "无法创建运行时目录".to_string())?;
    let active = runtimes.join(digest);
    if active.exists() {
        return validate_payload(&active);
    }
    let staging = runtimes.join(format!("{digest}-staging-{}", Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|_| "无法创建运行时暂存目录".to_string())?;
    let installed = (|| -> Result<PathBuf, String> {
        let mut archive = tar::Archive::new(
            fs::File::open(&archive_path).map_err(|_| "无法重新打开运行时归档".to_string())?,
        );
        let mut count = 0usize;
        #[cfg(unix)]
        let mut links = Vec::<(PathBuf, PathBuf)>::new();
        for entry in archive
            .entries()
            .map_err(|_| "运行时归档目录损坏".to_string())?
        {
            let mut entry = entry.map_err(|_| "运行时归档条目损坏".to_string())?;
            count += 1;
            if count > 200_000 {
                return Err("运行时归档条目过多".into());
            }
            let path = entry.path().map_err(|_| "运行时归档路径无效".to_string())?;
            if path
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
            {
                return Err("运行时归档包含非法路径".into());
            }
            let kind = entry.header().entry_type();
            if kind.is_symlink() {
                #[cfg(unix)]
                {
                    let target = entry
                        .link_name()
                        .map_err(|_| "运行时链接目标无效".to_string())?
                        .ok_or("运行时链接缺少目标")?;
                    if target.is_absolute() || target.to_string_lossy().len() > 4096 {
                        return Err("运行时链接目标不安全".into());
                    }
                    let mut normalized = PathBuf::new();
                    for part in path
                        .parent()
                        .unwrap_or(Path::new(""))
                        .join(&target)
                        .components()
                    {
                        match part {
                            Component::Normal(name) => normalized.push(name),
                            Component::CurDir => {}
                            Component::ParentDir if normalized.pop() => {}
                            _ => return Err("运行时链接越过资源目录".into()),
                        }
                    }
                    if normalized.as_os_str().is_empty() {
                        return Err("运行时链接目标无效".into());
                    }
                    links.push((path.to_path_buf(), target.to_path_buf()));
                    continue;
                }
                #[cfg(not(unix))]
                return Err("当前平台不接受运行时链接".into());
            }
            if !kind.is_file() && !kind.is_dir() {
                return Err("运行时归档包含非普通文件".into());
            }
            entry
                .unpack_in(&staging)
                .map_err(|_| "解包运行时失败".to_string())?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            for (link, target) in &links {
                let destination = staging.join(&link);
                if destination.exists() || destination.symlink_metadata().is_ok() {
                    return Err("运行时归档包含重复链接路径".into());
                }
                symlink(target, &destination).map_err(|_| "创建运行时链接失败".to_string())?;
            }
            for (link, _) in links {
                let destination = staging.join(&link);
                let resolved = destination
                    .canonicalize()
                    .map_err(|_| "运行时链接悬空".to_string())?;
                if !resolved.starts_with(&staging) {
                    return Err("运行时链接越过资源目录".into());
                }
            }
        }
        validate_payload(&staging)?;
        fs::rename(&staging, &active).map_err(|_| "启用运行时失败".to_string())?;
        validate_payload(&active)
    })();
    if installed.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    installed
}
