#[cfg(target_os = "macos")]
use objc2::ClassType;
#[cfg(target_os = "macos")]
use objc2_app_kit::NSPasteboard;
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSURL};
#[cfg(target_os = "macos")]
use std::ffi::CStr;

#[tauri::command]
pub fn read_clipboard_file_paths() -> Vec<String> {
    #[cfg(target_os = "macos")]
    unsafe {
        let pasteboard = NSPasteboard::generalPasteboard();
        let url_classes = NSArray::from_slice(&[NSURL::class()]);
        let Some(items) = pasteboard.readObjectsForClasses_options(&url_classes, None) else {
            return Vec::new();
        };
        let mut paths = Vec::new();
        for item in items.iter() {
            let Some(url) = item.downcast_ref::<NSURL>() else {
                continue;
            };
            if !url.isFileURL() {
                continue;
            }
            if let Some(path) = url.filePathURL().and_then(|url| url.path()) {
                paths.push(
                    CStr::from_ptr(path.UTF8String())
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
        return paths;
    }

    #[cfg(not(target_os = "macos"))]
    Vec::new()
}
