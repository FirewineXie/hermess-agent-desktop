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
    if window.label() == "quick-input" {
        if let WindowEvent::Focused(false) = event {
            let _ = window.hide();
        }
    }
    if hides_on_close(window.label()) {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

fn hides_on_close(label: &str) -> bool {
    matches!(label, "main" | "quick-input")
}

#[cfg(test)]
#[path = "tests/tray.rs"]
mod tests;

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
                crate::diagnostics::log_client_event("tray quit requested");
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let Ok(processes) = crate::process_manager::ProcessManager::current() else {
                        crate::diagnostics::log_client_event(
                            "ERROR tray quit: process manager unavailable",
                        );
                        app.exit(1);
                        return;
                    };
                    let state = app.state::<crate::runtime::BackendState>();
                    let whatsapp =
                        app.state::<crate::runtime::channel_whatsapp::WhatsAppSetupState>();
                    if !processes.begin_shutdown() {
                        return;
                    }
                    let service_cleanup = tokio::time::timeout(
                        std::time::Duration::from_secs(5),
                        crate::runtime::plugin_services::Cleanup::capture(&app, &state),
                    )
                    .await;
                    crate::device::shutdown(&app);
                    crate::panel_terminal::close_all_panel_terminals(
                        app.state::<crate::panel_terminal::TerminalState>(),
                    );
                    let bridge = app.state::<crate::runtime::browser_bridge::BrowserBridgeState>();
                    bridge.stop_all().await;
                    let coding_stopped = crate::runtime::coding::shutdown(&app).await;
                    let _ = processes.kill_temporary();
                    let stopped = tokio::time::timeout(
                        std::time::Duration::from_secs(25),
                        crate::runtime::stop_backend(state, bridge, whatsapp),
                    )
                    .await;
                    let remaining = processes.kill_remaining();
                    if !remaining.is_empty() {
                        eprintln!("Force-closed remaining desktop processes: {remaining:?}");
                    }
                    // Gateway and tool trees are gone before service stop commands:
                    // they must not restart a service during verification.
                    let services_stopped = match service_cleanup {
                        Ok(Ok(Some(cleanup))) => cleanup.run().await,
                        Ok(Ok(None)) => true,
                        Ok(Err(reason)) => {
                            crate::diagnostics::log_client_event(&format!(
                                "ERROR tray quit: plugin service cleanup context unavailable reason={reason}",
                            ));
                            false
                        }
                        Err(_) => {
                            crate::diagnostics::log_client_event(
                                "ERROR tray quit: plugin service cleanup context timed out",
                            );
                            false
                        }
                    };
                    let _ = processes.kill_remaining();
                    let clean_exit =
                        coding_stopped && services_stopped && matches!(stopped, Ok(Ok(())));
                    crate::diagnostics::log_client_event(if clean_exit {
                        "tray quit completed"
                    } else {
                        "ERROR tray quit: runtime or plugin service cleanup failed or timed out"
                    });
                    app.exit(if clean_exit { 0 } else { 1 });
                });
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
