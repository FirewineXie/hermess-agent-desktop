use std::{io, time::Instant};
use tokio::process::Command;

pub struct PlatformManager;

impl PlatformManager {
    pub fn new() -> io::Result<Self> {
        Ok(Self)
    }
}

pub fn configure_command(_command: &mut Command) {}

pub struct ProcessJob(std::os::windows::io::OwnedHandle);
pub type ProcessTree = ProcessJob;

impl ProcessJob {
    pub fn new(_platform: &PlatformManager) -> io::Result<Self> {
        use std::os::windows::io::FromRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        let handle = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(raw) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                raw,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(handle))
    }

    pub fn assign(&mut self, pid: u32) -> io::Result<()> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };
        let raw = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        let process = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(raw) };
        if unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), process.as_raw_handle()) } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub fn terminate_and_wait(&mut self, deadline: Instant) -> bool {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicAccountingInformation, QueryInformationJobObject, TerminateJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        };
        if unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) } == 0 {
            return false;
        }
        loop {
            let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            if unsafe {
                QueryInformationJobObject(
                    self.0.as_raw_handle(),
                    JobObjectBasicAccountingInformation,
                    &mut accounting as *mut _ as *mut _,
                    std::mem::size_of_val(&accounting) as u32,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                return false;
            }
            if accounting.ActiveProcesses == 0 {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
}

pub fn watch_exit(
    pid: u32,
    kind: &'static str,
    on_exit: impl FnOnce() + Send + 'static,
) -> io::Result<()> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
    let raw = unsafe { OpenProcess(0x0010_0000, 0, pid) };
    if raw.is_null() {
        return Err(io::Error::last_os_error());
    }
    let handle = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(raw) };
    std::thread::Builder::new()
        .name(format!("process-reaper-{kind}"))
        .spawn(move || {
            unsafe { WaitForSingleObject(handle.as_raw_handle(), u32::MAX) };
            on_exit();
        })?;
    Ok(())
}
