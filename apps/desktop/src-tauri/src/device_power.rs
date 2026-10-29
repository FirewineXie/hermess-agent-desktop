//! Native power assertions. No helper processes and no thread-affine wake flags.
#[cfg(windows)]
pub struct WakeGuard(isize);
#[cfg(windows)]
impl WakeGuard {
    pub fn acquire() -> Result<Self, String> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
            System::{Power::*, Threading::*},
        };
        let mut reason: Vec<u16> = "Hermess owned runtime is running\0"
            .encode_utf16()
            .collect();
        let context = REASON_CONTEXT {
            Version: 0,
            Flags: 1,
            Reason: REASON_CONTEXT_0 {
                SimpleReasonString: reason.as_mut_ptr(),
            },
        };
        unsafe {
            let handle = PowerCreateRequest(&context);
            if handle == INVALID_HANDLE_VALUE || handle.is_null() {
                return Err("无法创建系统唤醒请求".into());
            }
            if PowerSetRequest(handle, PowerRequestSystemRequired) == 0 {
                CloseHandle(handle);
                return Err("系统拒绝保持唤醒".into());
            }
            Ok(Self(handle as isize))
        }
    }
}
#[cfg(windows)]
impl Drop for WakeGuard {
    fn drop(&mut self) {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::Power::{PowerClearRequest, PowerRequestSystemRequired},
        };
        unsafe {
            PowerClearRequest(self.0 as _, PowerRequestSystemRequired);
            CloseHandle(self.0 as _);
        }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void};
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            text: *const c_char,
            encoding: u32,
        ) -> *const c_void;
        fn CFRelease(value: *const c_void);
    }
    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            kind: *const c_void,
            level: u32,
            name: *const c_void,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }
    pub struct WakeGuard(u32);
    impl WakeGuard {
        pub fn acquire() -> Result<Self, String> {
            unsafe {
                let kind = CFStringCreateWithCString(
                    std::ptr::null(),
                    c"PreventUserIdleSystemSleep".as_ptr(),
                    0x08000100,
                );
                let name = CFStringCreateWithCString(
                    std::ptr::null(),
                    c"Hermess owned runtime".as_ptr(),
                    0x08000100,
                );
                if kind.is_null() || name.is_null() {
                    if !kind.is_null() {
                        CFRelease(kind);
                    }
                    if !name.is_null() {
                        CFRelease(name);
                    }
                    return Err("无法创建电源断言".into());
                }
                let mut id = 0;
                let result = IOPMAssertionCreateWithName(kind, 255, name, &mut id);
                CFRelease(kind);
                CFRelease(name);
                if result == 0 {
                    Ok(Self(id))
                } else {
                    Err("系统拒绝保持唤醒".into())
                }
            }
        }
    }
    impl Drop for WakeGuard {
        fn drop(&mut self) {
            unsafe {
                IOPMAssertionRelease(self.0);
            }
        }
    }
}
#[cfg(target_os = "macos")]
pub use mac::WakeGuard;

#[cfg(not(any(windows, target_os = "macos")))]
pub struct WakeGuard;
#[cfg(not(any(windows, target_os = "macos")))]
impl WakeGuard {
    pub fn acquire() -> Result<Self, String> {
        Err("当前平台不支持保持唤醒".into())
    }
}
