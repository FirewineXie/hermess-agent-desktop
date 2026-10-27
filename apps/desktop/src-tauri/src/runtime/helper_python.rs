use serde_json::Value;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tokio::process::Command;

const PACKED_BOOTSTRAP: &str = r#"import site,sys
from pathlib import Path
root=Path(sys.argv[1])
site.addsitedir(str(root/sys.argv[2]))
sys.path.insert(0,str(root/sys.argv[3]))
script=sys.argv[4]
sys.argv=sys.argv[4:]
exec(compile(script,'<desktop-helper>','exec'))
"#;

fn payload_path(root: &Path, value: &Value, key: &str) -> Result<PathBuf, String> {
    let relative = value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("内置运行时缺少 {key}"))?;
    let path = Path::new(relative);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(format!("内置运行时的 {key} 路径无效"));
    }
    Ok(root.join(path))
}

pub(super) fn command(hermes: &Path, script: &str) -> Result<Command, String> {
    let bin = hermes.parent().ok_or("无法定位网关运行时")?;
    let root = bin.parent().ok_or("无法定位网关运行时")?;
    let manifest_file = root.join("manifest.json");
    if manifest_file.is_file() {
        let manifest: Value =
            serde_json::from_slice(&fs::read(manifest_file).map_err(|_| "无法读取内置运行时清单")?)
                .map_err(|_| "内置运行时清单无效")?;
        let runtime = manifest
            .get("runtime")
            .ok_or("内置运行时清单缺少运行时配置")?;
        let python = payload_path(root, runtime, "storePython")?;
        let site = payload_path(root, runtime, "sitePackages")?;
        let repo = payload_path(root, runtime, "repoDir")?;
        if !python.is_file() || !site.is_dir() || !repo.is_dir() {
            return Err("内置 Python 或依赖目录不存在".into());
        }
        let child_paths =
            std::env::join_paths([&repo, &site]).map_err(|_| "内置 Python 依赖路径无效")?;
        let mut command = Command::new(python);
        command
            .args(["-I", "-S", "-u", "-X", "utf8", "-c", PACKED_BOOTSTRAP])
            .arg(root)
            .arg(site.strip_prefix(root).map_err(|_| "内置依赖目录无效")?)
            .arg(repo.strip_prefix(root).map_err(|_| "内置源码目录无效")?)
            .arg(script)
            .env_remove("PYTHONHOME")
            .env("PYTHONPATH", child_paths);
        return Ok(command);
    }
    if !cfg!(debug_assertions) {
        return Err("发行版缺少内置运行时清单".into());
    }
    let python = bin.join(if cfg!(windows) {
        "python.exe"
    } else {
        "python"
    });
    if !python.is_file() {
        return Err("网关解释器不存在".into());
    }
    let mut command = Command::new(python);
    command.args(["-P", "-u", "-c", script]);
    Ok(command)
}

#[cfg(test)]
#[path = "tests/helper_python.rs"]
mod tests;
