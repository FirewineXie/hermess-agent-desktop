//! Client for the pinned Hermes Gateway private control protocol (v1).
//! The desktop owns the launched process; never discover an arbitrary local Gateway.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MAX_RESPONSE: usize = 512 * 1024;

fn owned_process(launched_pid: u32, gateway_pid: u32) -> bool {
    if gateway_pid == launched_pid {
        return true;
    }
    #[cfg(windows)]
    {
        windows_descendant(launched_pid, gateway_pid)
    }
    // POSIX launchers use a shebang/exec; the Gateway replaces the launched process.
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn windows_descendant(launched_pid: u32, gateway_pid: u32) -> bool {
    use std::collections::HashMap;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return false;
    }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut parents = HashMap::new();
    let mut found = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while found {
        parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
        found = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    let mut current = gateway_pid;
    for _ in 0..32 {
        let Some(parent) = parents.get(&current).copied() else {
            return false;
        };
        if parent == launched_pid {
            return true;
        }
        if parent == 0 || parent == current {
            return false;
        }
        current = parent;
    }
    false
}

fn lock_pid(home: &Path) -> Result<Option<u32>, String> {
    let lock = match fs::read(home.join("gateway.lock")) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取自有网关锁".into()),
    };
    let Ok(value) = serde_json::from_slice::<Value>(&lock) else {
        // The owner may still be publishing its lock during startup.
        return Ok(None);
    };
    let Some(pid) = value
        .get("pid")
        .and_then(Value::as_u64)
        .and_then(|pid| u32::try_from(pid).ok())
        .filter(|pid| *pid != 0)
    else {
        return Ok(None);
    };
    Ok(Some(pid))
}

fn home_hash(home: &Path) -> Result<String, String> {
    let canonical = home.canonicalize().map_err(|_| "无法解析网关存储路径")?;
    hash_canonical_home(home, &canonical)
}

fn hash_canonical_home(home: &Path, canonical: &Path) -> Result<String, String> {
    let path = canonical.to_str().ok_or("网关存储路径不是 UTF-8")?;
    #[cfg(windows)]
    let path = {
        // Python's Path.resolve() preserves an existing extended-length prefix but does not
        // introduce one for a regular path. Rust canonicalize() always introduces it.
        let resolved = if home.to_string_lossy().starts_with(r"\\?\") {
            path.to_owned()
        } else if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{unc}")
        } else {
            path.strip_prefix(r"\\?\").unwrap_or(path).to_owned()
        };
        resolved.replace('/', "\\").to_lowercase()
    };
    let digest = Sha256::digest(path.as_bytes());
    Ok(digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(test)]
#[path = "tests/gateway_control.rs"]
mod tests;

async fn exchange(
    home: &Path,
    expected_pid: u32,
    request: &Value,
    budget: Duration,
) -> Result<Option<Value>, String> {
    let mut bytes = serde_json::to_vec(request).map_err(|_| "无法编码网关控制请求")?;
    bytes.push(b'\n');
    let response = tokio::time::timeout(budget, transport(home, expected_pid, &bytes))
        .await
        .map_err(|_| "网关私有控制端超时")??;
    let Some(response) = response else {
        return Ok(None);
    };
    let value: Value = serde_json::from_slice(&response).map_err(|_| "网关控制响应不是 JSON")?;
    if value.get("ok").and_then(Value::as_bool) != Some(true)
        || value.get("protocol").and_then(Value::as_u64) != Some(1)
        || value.get("id").and_then(Value::as_u64) != Some(1)
    {
        return Err("网关私有控制端拒绝或返回无效协议".into());
    }
    value
        .get("result")
        .filter(|result| result.is_object())
        .cloned()
        .map(Some)
        .ok_or_else(|| "网关控制响应缺少结果".into())
}

#[cfg(windows)]
async fn transport(
    home: &Path,
    expected_pid: u32,
    request: &[u8],
) -> Result<Option<Vec<u8>>, String> {
    use std::os::windows::io::AsRawHandle;
    use tokio::net::windows::named_pipe::ClientOptions;
    use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;

    let name = format!(r"\\.\pipe\hermes-gateway-{}", home_hash(home)?);
    let mut pipe = match ClientOptions::new().open(name) {
        Ok(pipe) => pipe,
        Err(error) if matches!(error.raw_os_error(), Some(2 | 231)) => return Ok(None),
        Err(_) => return Err("无法连接自有网关控制管道".into()),
    };
    let mut server_pid = 0u32;
    let verified =
        unsafe { GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut server_pid) } != 0;
    if !verified || server_pid != expected_pid {
        return Err("网关控制管道不属于自有进程".into());
    }
    pipe.write_all(request)
        .await
        .map_err(|_| "网关控制请求发送失败")?;
    read_response(&mut pipe).await.map(Some)
}

#[cfg(unix)]
async fn transport(
    home: &Path,
    expected_pid: u32,
    request: &[u8],
) -> Result<Option<Vec<u8>>, String> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    use tokio::net::UnixStream;

    let home_meta = fs::symlink_metadata(home).map_err(|_| "无法核对网关存储目录")?;
    if !home_meta.is_dir()
        || home_meta.uid() != unsafe { libc::geteuid() }
        || home_meta.mode() & 0o002 != 0
    {
        return Err("网关存储目录权限不安全".into());
    }
    let direct = home.join("gateway.sock");
    let socket = if direct.exists() {
        direct
    } else {
        let pointer = home.join("gateway.sock.path");
        let meta = match fs::symlink_metadata(&pointer) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("无法读取网关控制指针".into()),
        };
        if !meta.is_file()
            || meta.uid() != unsafe { libc::geteuid() }
            || meta.mode() & 0o077 != 0
            || meta.len() > 4096
        {
            return Err("网关控制指针权限不安全".into());
        }
        let path = fs::read_to_string(&pointer).map_err(|_| "无法读取网关控制指针")?;
        let target = std::path::PathBuf::from(path.trim());
        if !target.is_absolute()
            || target.file_name().is_none_or(|name| name != "control.sock")
            || target.parent().and_then(Path::file_name)
                != Some(std::ffi::OsStr::new(&format!(
                    "hermes-gw-{}",
                    home_hash(home)?
                )))
        {
            return Err("网关控制指针无效".into());
        }
        check_private_node(target.parent().ok_or("网关控制目录无效")?, false)?;
        target
    };
    let meta = match fs::symlink_metadata(&socket) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法核对网关控制套接字".into()),
    };
    if !meta.file_type().is_socket()
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.mode() & 0o077 != 0
    {
        return Err("网关控制套接字权限不安全".into());
    }
    let mut stream = match UnixStream::connect(&socket).await {
        Ok(stream) => stream,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
            ) =>
        {
            return Ok(None)
        }
        Err(_) => return Err("无法连接网关控制套接字".into()),
    };
    verify_unix_peer(&stream, expected_pid)?;
    stream
        .write_all(request)
        .await
        .map_err(|_| "网关控制请求发送失败")?;
    read_response(&mut stream).await.map(Some)
}

#[cfg(unix)]
fn check_private_node(path: &Path, socket: bool) -> Result<(), String> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    let meta = fs::symlink_metadata(path).map_err(|_| "网关控制路径不存在")?;
    if (socket && !meta.file_type().is_socket())
        || (!socket && !meta.is_dir())
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.mode() & 0o077 != 0
    {
        return Err("网关控制路径权限不安全".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn verify_unix_peer(stream: &tokio::net::UnixStream, expected_pid: u32) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let mut uid = 0;
    let mut gid = 0;
    let mut pid: libc::pid_t = 0;
    let mut size = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0
        || uid != unsafe { libc::geteuid() }
        || unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_LOCAL,
                libc::LOCAL_PEERPID,
                (&mut pid as *mut libc::pid_t).cast(),
                &mut size,
            )
        } != 0
        || size as usize != std::mem::size_of::<libc::pid_t>()
        || pid != expected_pid as libc::pid_t
    {
        return Err("网关控制套接字对端身份不符".into());
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn verify_unix_peer(stream: &tokio::net::UnixStream, expected_pid: u32) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut size = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    if unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut size,
        )
    } != 0
        || size as usize != std::mem::size_of::<libc::ucred>()
        || cred.uid != unsafe { libc::geteuid() }
        || cred.pid != expected_pid as libc::pid_t
    {
        return Err("网关控制套接字对端身份不符".into());
    }
    Ok(())
}

async fn read_response<R: AsyncReadExt + Unpin>(stream: &mut R) -> Result<Vec<u8>, String> {
    let mut response = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let count = stream
            .read(&mut chunk)
            .await
            .map_err(|_| "无法读取网关控制响应")?;
        if count == 0 {
            return Err("网关控制响应不完整".into());
        }
        response.extend_from_slice(&chunk[..count]);
        if response.len() > MAX_RESPONSE {
            return Err("网关控制响应过大".into());
        }
        if let Some(end) = response.iter().position(|byte| *byte == b'\n') {
            response.truncate(end);
            return Ok(response);
        }
    }
}

pub(super) async fn discover(
    home: &Path,
    launched_pid: u32,
) -> Result<Option<(u16, Value)>, String> {
    let Some(gateway_pid) = lock_pid(home)? else {
        return Ok(None);
    };
    if !owned_process(launched_pid, gateway_pid) {
        return Ok(None);
    }
    let Some(identity) = exchange(
        home,
        gateway_pid,
        &json!({"protocol": 1, "id": 1, "verb": "identify"}),
        Duration::from_secs(2),
    )
    .await?
    else {
        return Ok(None);
    };
    if identity.get("state").and_then(Value::as_str) != Some("ready") {
        return Ok(None);
    }
    if identity.get("runtime_protocol").and_then(Value::as_u64) != Some(1)
        || !identity
            .get("capabilities")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.as_str() == Some("session-authority-v1"))
            })
    {
        return Err("网关私有协议不兼容".into());
    }
    let profile = identity
        .get("served_profiles")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find(|item| {
                item.get("home")
                    .and_then(Value::as_str)
                    .is_some_and(|path| same_home(path, home))
            })
        })
        .and_then(|item| item.get("profile_id"))
        .and_then(Value::as_str)
        .ok_or("网关未声明当前 Profile")?;
    let instance = identity
        .get("instance_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or("网关缺少实例身份")?;
    let origin = identity
        .get("api_origin")
        .and_then(Value::as_str)
        .ok_or("网关缺少地址")?;
    let port = origin
        .strip_prefix("http://127.0.0.1:")
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port != 0)
        .ok_or("网关返回无效地址")?;
    let endpoint = json!({"profile_id": profile, "instance_id": instance,
        "runtime_protocol": 1, "api_origin": origin, "control_home": Value::Null});
    Ok(Some((port, endpoint)))
}

fn same_home(path: &str, home: &Path) -> bool {
    let Ok(left) = Path::new(path).canonicalize() else {
        return false;
    };
    let Ok(right) = home.canonicalize() else {
        return false;
    };
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

pub(super) async fn ticket(
    home: &Path,
    endpoint: &Value,
    launched_pid: u32,
) -> Result<String, String> {
    let profile = endpoint
        .get("profile_id")
        .and_then(Value::as_str)
        .ok_or("网关 Profile 无效")?;
    let instance = endpoint
        .get("instance_id")
        .and_then(Value::as_str)
        .ok_or("网关实例无效")?;
    if !same_home(profile, home)
        || endpoint.get("runtime_protocol").and_then(Value::as_u64) != Some(1)
    {
        return Err("网关身份已变化".into());
    }
    let gateway_pid = lock_pid(home)?.ok_or("自有网关锁不存在")?;
    if !owned_process(launched_pid, gateway_pid) {
        return Err("网关进程不属于当前桌面实例".into());
    }
    let result = exchange(
        home,
        gateway_pid,
        &json!({"protocol": 1, "id": 1,
        "verb": "session-ticket", "params": {"profile_id": profile,
        "instance_id": instance, "purpose": "interactive", "scope": "host"}}),
        Duration::from_secs(5),
    )
    .await?
    .ok_or("网关私有控制端不可用")?;
    if result.get("profile_id").and_then(Value::as_str) != Some(profile)
        || result.get("instance_id").and_then(Value::as_str) != Some(instance)
        || result.get("runtime_protocol").and_then(Value::as_u64) != Some(1)
    {
        return Err("网关票据身份不符".into());
    }
    let value = result
        .get("ticket")
        .and_then(Value::as_str)
        .ok_or("网关票据无效")?;
    if value.is_empty() || value.len() > 4096 || !value.is_ascii() {
        return Err("网关票据无效".into());
    }
    Ok(value.to_owned())
}
