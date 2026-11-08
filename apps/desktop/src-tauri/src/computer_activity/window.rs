use super::{ComputerActivityState, Phase};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub(super) const LABEL: &str = "computer-activity";
pub(super) const SHORTCUT: &str = "CommandOrControl+Shift+F12";

// Tao's focused(false) marker is consumed at creation; a later show() uses SW_SHOW.
// This isolated window owns both native show and hide so Tao's cached visibility
// flag cannot suppress a hide after an unactivated native show.
#[cfg(windows)]
fn set_visible(window: &tauri::WebviewWindow, visible: bool) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsWindowVisible, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE,
    };
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    unsafe {
        if visible {
            SetWindowPos(
                hwnd.0 as _,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            ) != 0
        } else {
            ShowWindow(hwnd.0 as _, SW_HIDE);
            IsWindowVisible(hwnd.0 as _) == 0
        }
    }
}

#[cfg(not(windows))]
fn set_visible(window: &tauri::WebviewWindow, visible: bool) -> bool {
    if visible {
        window.show().is_ok()
    } else {
        window.hide().is_ok()
    }
}

pub(super) fn register_shortcut(app: &AppHandle) -> bool {
    let registered = SHORTCUT
        .parse::<Shortcut>()
        .is_ok_and(|shortcut| app.global_shortcut().register(shortcut).is_ok());
    if !registered {
        crate::diagnostics::log_client_event("ERROR computer_activity_shortcut_unavailable");
    }
    registered
}

pub(super) fn handle_shortcut(app: &AppHandle, shortcut: &Shortcut) -> bool {
    if SHORTCUT
        .parse::<Shortcut>()
        .is_ok_and(|expected| &expected == shortcut)
    {
        super::stop_all(app);
        true
    } else {
        false
    }
}

pub(super) fn refresh(app: &AppHandle) {
    let handle = app.clone();
    if app
        .run_on_main_thread(move || {
            let state = handle.state::<ComputerActivityState>();
            let Ok(inner) = state.inner.lock() else {
                return;
            };
            let status = inner.status();
            drop(inner);
            let existing = handle.get_webview_window(LABEL);
            if status.phase == Phase::Idle {
                if let Some(window) = existing {
                    if !set_visible(&window, false) {
                        crate::diagnostics::log_client_event(
                            "ERROR computer_activity_window_hide_failed",
                        );
                    }
                }
                return;
            }
            let result = match existing {
                Some(window) => Ok(window),
                None => {
                    let builder = WebviewWindowBuilder::new(
                        &handle,
                        LABEL,
                        WebviewUrl::App("computer-activity.html".into()),
                    )
                    .title("电脑操作提示")
                    .inner_size(440.0, 48.0)
                    .decorations(false)
                    .resizable(false)
                    .minimizable(false)
                    .maximizable(false)
                    .closable(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .focused(false)
                    .focusable(false)
                    .visible(false);
                    #[cfg(target_os = "macos")]
                    let builder = builder.visible_on_all_workspaces(true);
                    builder.build()
                }
            };
            match result {
                Ok(window) => {
                    let height = if status.phase == Phase::Unknown || status.shortcut_unavailable {
                        72.0
                    } else {
                        48.0
                    };
                    if window
                        .set_size(tauri::LogicalSize::new(440.0, height))
                        .is_err()
                    {
                        crate::diagnostics::log_client_event(
                            "ERROR computer_activity_window_resize_failed",
                        );
                    }
                    if !window.is_visible().unwrap_or(false) {
                        // Position using physical monitor origin and scale (including negative coordinates).
                        if let Ok(Some(monitor)) = handle
                            .cursor_position()
                            .and_then(|point| handle.monitor_from_point(point.x, point.y))
                            .or_else(|_| window.primary_monitor())
                        {
                            let origin = monitor.position();
                            let width = (440.0 * monitor.scale_factor()).round() as i32;
                            let _ = window.set_position(PhysicalPosition::new(
                                origin.x + (monitor.size().width as i32 - width) / 2,
                                origin.y + (32.0 * monitor.scale_factor()) as i32,
                            ));
                        }
                        if !set_visible(&window, true) {
                            crate::diagnostics::log_client_event(
                                "ERROR computer_activity_window_show_failed",
                            );
                        }
                    }
                    let app = &handle;
                    let _ = app.emit_to("computer-activity", "computer-activity", status);
                }
                Err(_) => crate::diagnostics::log_client_event(
                    "ERROR computer_activity_window_create_failed",
                ),
            }
        })
        .is_err()
    {
        crate::diagnostics::log_client_event("ERROR computer_activity_window_dispatch_failed");
    }
}
