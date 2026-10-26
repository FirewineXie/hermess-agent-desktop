use std::{
    collections::HashSet,
    io::{self, BufRead, BufReader, Write},
    os::{fd::FromRawFd, unix::process::CommandExt},
    process::{Child, ChildStdin, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::process::Command;

const WATCHDOG_ARG: &str = "--hermess-process-watchdog";

// A descendant may call setsid/setpgid and leave this group. Group cleanup
// covers members that remain in the group; it is not a Job Object equivalent.

pub struct PlatformManager {
    watchdog: Option<Arc<Mutex<ChildStdin>>>,
    _child: Option<Child>,
}

impl PlatformManager {
    pub fn new() -> io::Result<Self> {
        let mut child = std::process::Command::new(std::env::current_exe()?)
            .arg(WATCHDOG_ARG)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("进程守护管道不可用"))?;
        Ok(Self {
            watchdog: Some(Arc::new(Mutex::new(stdin))),
            _child: Some(child),
        })
    }

    #[cfg(test)]
    pub fn for_test() -> Self {
        Self {
            watchdog: None,
            _child: None,
        }
    }
}

pub fn maybe_run_watchdog() -> bool {
    if std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new(WATCHDOG_ARG)) {
        return false;
    }
    let mut groups = HashSet::<i32>::new();
    let stdin = io::stdin();
    for line in BufReader::new(stdin.lock()).lines() {
        let Ok(line) = line else { break };
        let Some((action, pid)) = line.split_at_checked(1) else {
            continue;
        };
        let Ok(pid) = pid.parse::<i32>() else {
            continue;
        };
        if pid <= 0 {
            continue;
        }
        match action {
            "+" => {
                groups.insert(pid);
            }
            "-" => {
                groups.remove(&pid);
            }
            _ => {}
        }
    }
    for pid in groups {
        unsafe { libc::kill(-pid, libc::SIGKILL) };
    }
    true
}

fn notify(watchdog: &Arc<Mutex<ChildStdin>>, action: char, pid: i32) -> io::Result<()> {
    let mut writer = watchdog
        .lock()
        .map_err(|_| io::Error::other("进程守护管道锁不可用"))?;
    writer.write_all(format!("{action}{pid}\n").as_bytes())
}

pub fn configure_command(command: &mut Command) {
    command.as_std_mut().process_group(0);
}

pub struct ProcessTree {
    pid: Option<i32>,
    watchdog: Option<Arc<Mutex<ChildStdin>>>,
}

impl ProcessTree {
    pub fn new(platform: &PlatformManager) -> io::Result<Self> {
        Ok(Self {
            pid: None,
            watchdog: platform.watchdog.clone(),
        })
    }

    pub fn assign(&mut self, pid: u32) -> io::Result<()> {
        let pid = i32::try_from(pid).map_err(|_| io::Error::other("进程 PID 超出范围"))?;
        let group = unsafe { libc::getpgid(pid) };
        if group != pid
            && !(group == -1 && io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH))
        {
            return Err(io::Error::other("子进程未建立独立进程组"));
        }
        self.pid = Some(pid);
        if let Some(watchdog) = &self.watchdog {
            notify(watchdog, '+', pid)?;
        }
        Ok(())
    }

    pub fn terminate_and_wait(&mut self, deadline: Instant) -> bool {
        let Some(pid) = self.pid else { return true };
        unsafe { libc::kill(-pid, libc::SIGKILL) };
        loop {
            if unsafe { libc::kill(-pid, 0) } == -1 {
                let gone = io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH);
                if gone {
                    self.pid = None;
                    if let Some(watchdog) = &self.watchdog {
                        let _ = notify(watchdog, '-', pid);
                    }
                }
                return gone;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for ProcessTree {
    fn drop(&mut self) {
        if let Some(pid) = self.pid {
            unsafe { libc::kill(-pid, libc::SIGKILL) };
            if let Some(watchdog) = &self.watchdog {
                let _ = notify(watchdog, '-', pid);
            }
        }
    }
}

pub fn watch_exit(
    pid: u32,
    kind: &'static str,
    on_exit: impl FnOnce() + Send + 'static,
) -> io::Result<()> {
    let fd = unsafe { libc::kqueue() };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let queue = unsafe { std::os::fd::OwnedFd::from_raw_fd(fd) };
    let event = libc::kevent {
        ident: pid as libc::uintptr_t,
        filter: libc::EVFILT_PROC,
        flags: libc::EV_ADD | libc::EV_ONESHOT,
        fflags: libc::NOTE_EXIT,
        data: 0,
        udata: std::ptr::null_mut(),
    };
    if unsafe { libc::kevent(fd, &event, 1, std::ptr::null_mut(), 0, std::ptr::null()) } < 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            std::thread::Builder::new()
                .name(format!("process-reaper-{kind}"))
                .spawn(on_exit)?;
            return Ok(());
        }
        return Err(error);
    }
    std::thread::Builder::new()
        .name(format!("process-reaper-{kind}"))
        .spawn(move || {
            let mut event = std::mem::MaybeUninit::<libc::kevent>::uninit();
            let result = unsafe {
                libc::kevent(
                    fd,
                    std::ptr::null(),
                    0,
                    event.as_mut_ptr(),
                    1,
                    std::ptr::null(),
                )
            };
            if result > 0 {
                on_exit();
            }
            drop(queue);
        })?;
    Ok(())
}
