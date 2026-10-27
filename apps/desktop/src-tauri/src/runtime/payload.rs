use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};

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

pub(super) fn validate_payload(payload: &Path) -> Result<PathBuf, String> {
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
