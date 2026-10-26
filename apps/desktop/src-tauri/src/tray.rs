use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Window, WindowEvent,
};

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "打开主界面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Hermess", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().ok_or("缺少托盘图标")?.clone())
        .tooltip("Hermess Agent Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<crate::runtime::BackendState>();
                    let bridge = app.state::<crate::runtime::browser_bridge::BrowserBridgeState>();
                    if crate::runtime::stop_backend(state, bridge).await.is_ok() {
                        app.exit(0);
                    } else {
                        show_main_window(&app);
                    }
                });
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
