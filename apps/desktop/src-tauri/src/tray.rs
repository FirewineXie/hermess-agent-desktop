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
                    let Ok(processes) = crate::process_manager::ProcessManager::current() else {
                        app.exit(1);
                        return;
                    };
                    if !processes.begin_shutdown() {
                        return;
                    }
                    crate::panel_terminal::close_all_panel_terminals(
                        app.state::<crate::panel_terminal::TerminalState>(),
                    );
                    let state = app.state::<crate::runtime::BackendState>();
                    let bridge = app.state::<crate::runtime::browser_bridge::BrowserBridgeState>();
                    bridge.stop_all().await;
                    let _ = processes.kill_temporary();
                    let stopped = tokio::time::timeout(
                        std::time::Duration::from_secs(25),
                        crate::runtime::stop_backend(state, bridge),
                    )
                    .await;
                    let remaining = processes.kill_remaining();
                    if !remaining.is_empty() {
                        eprintln!("Force-closed remaining desktop processes: {remaining:?}");
                    }
                    app.exit(if matches!(stopped, Ok(Ok(()))) { 0 } else { 1 });
                });
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
