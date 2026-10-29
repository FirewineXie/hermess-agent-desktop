#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use tauri::Manager;

mod device;
mod device_power;
mod diagnostics;
mod errors;
mod gateway;
mod notifications;
mod panel_terminal;
mod process_manager;
mod quick_input;
mod runtime;
mod storage;
mod tray;
mod updates;
mod webview_cache;
mod workspace_panel;

fn main() {
    #[cfg(target_os = "macos")]
    if process_manager::maybe_run_watchdog() {
        return;
    }
    diagnostics::install_panic_logger();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        quick_input::show(app);
                    }
                })
                .build(),
        )
        .manage(device::DeviceState::default())
        .manage(quick_input::QuickState::default())
        .manage(runtime::BackendState::default())
        .manage(runtime::browser_bridge::BrowserBridgeState::default())
        .manage(runtime::channels::ChannelState::default())
        .manage(panel_terminal::TerminalState::default())
        .manage(updates::UpdateDownloadState::default())
        .setup(|app| {
            if let Some(storage) =
                runtime::existing_client_log_storage(app.handle()).or_else(|| {
                    app.path()
                        .app_local_data_dir()
                        .ok()
                        .map(|path| path.join("HermessAgentDesktop"))
                })
            {
                diagnostics::set_client_log_storage(storage);
            }
            process_manager::ProcessManager::init()?;
            tray::setup(app)?;
            device::setup(app.handle())?;
            webview_cache::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            device::get_device_status,
            device::save_device_preferences,
            quick_input::set_quick_target,
            quick_input::get_quick_target,
            quick_input::submit_quick_input,
            quick_input::take_quick_submission,
            quick_input::finish_quick_submission,
            runtime::delegation::get_delegation_routing,
            runtime::delegation::save_delegation_routing,
            runtime::provider_copy::preview_provider_copy,
            runtime::provider_copy::copy_provider,
            diagnostics::probe_local_tools,
            notifications::show_native_notification,
            webview_cache::get_webview_cache_settings,
            webview_cache::set_webview_cache_settings,
            webview_cache::clear_webview_cache_now,
            workspace_panel::list_workspace_panel_directory,
            workspace_panel::read_workspace_panel_file,
            workspace_panel::read_local_preview_html,
            panel_terminal::start_panel_terminal,
            panel_terminal::activate_panel_terminal,
            panel_terminal::write_panel_terminal,
            panel_terminal::resize_panel_terminal,
            panel_terminal::close_panel_terminal,
            runtime::dev_backend_defaults,
            runtime::start_dev_backend,
            runtime::packed_backend_defaults,
            runtime::start_packed_backend,
            runtime::ping_backend,
            runtime::reconnect_backend,
            runtime::restart_backend_gracefully,
            runtime::stop_backend,
            runtime::profiles::list_profiles,
            runtime::profiles::create_profile,
            runtime::workbuddy_import::inspect_workbuddy_import,
            runtime::workbuddy_import::import_workbuddy_package,
            runtime::profiles::select_profile,
            runtime::profile_data::get_profile_data_directory,
            runtime::profile_data::list_profile_data_directory,
            runtime::profile_data::open_profile_data_directory,
            runtime::personalities::list_personalities,
            runtime::personalities::apply_personality,
            diagnostics::read_diagnostic_logs,
            diagnostics::record_client_event,
            diagnostics::record_client_error,
            runtime::about::get_product_info,
            updates::check_updates,
            updates::start_update_download,
            updates::get_update_download_status,
            runtime::channels::channel_status,
            runtime::channels::channel_qr_start,
            runtime::channels::channel_qr_poll,
            runtime::channels::channel_qr_cancel,
            runtime::chat::create_chat_session,
            runtime::chat::submit_chat_prompt,
            runtime::chat::list_composer_commands,
            runtime::chat::execute_composer_command,
            runtime::chat::dispatch_composer_skill,
            runtime::chat::attach_chat_file,
            runtime::chat::attach_chat_image_bytes,
            runtime::chat::inspect_chat_file,
            runtime::chat::detach_chat_image,
            runtime::chat::answer_gateway_request,
            runtime::chat::list_chat_sessions,
            runtime::tools::list_bundled_tools,
            runtime::tools::list_profile_toolsets,
            runtime::downloadable_tools::list_downloadable_tools,
            runtime::downloadable_tools::install_downloadable_tool,
            runtime::usage::get_usage_statistics,
            runtime::extensions::extension_request,
            runtime::models::list_model_options,
            runtime::models::select_chat_model,
            runtime::models::get_moa_config,
            runtime::models::save_moa_config,
            runtime::models::get_saved_model_config,
            runtime::security::get_shared_metrics_consent,
            runtime::security::save_shared_metrics_consent,
            runtime::security::get_checkpoint_inventory,
            runtime::config::get_agent_config,
            runtime::config::get_agent_config_schema,
            runtime::config::get_agent_config_raw,
            runtime::config::save_auxiliary_route,
            runtime::chat::get_chat_reasoning,
            runtime::chat::set_chat_reasoning,
            runtime::chat::get_chat_usage,
            runtime::models::list_custom_endpoints,
            runtime::models::load_model_lists,
            runtime::models::save_model_lists,
            runtime::models::add_custom_endpoint,
            runtime::models::update_custom_endpoint,
            runtime::models::set_custom_endpoint_discovery,
            runtime::models::delete_custom_endpoint,
            runtime::config::save_agent_config_field,
            runtime::config::save_agent_config_raw,
            runtime::memory_provider::get_memory_providers,
            runtime::memory_provider::get_memory_provider_config,
            runtime::memory_provider::save_memory_provider_config,
            runtime::memory_provider::start_memory_provider_oauth,
            runtime::memory_provider::get_memory_provider_oauth_status,
            runtime::personal_files::read_personal_file,
            runtime::personal_files::save_personal_file,
            runtime::models::check_model_runtime,
            runtime::models::set_default_model,
            runtime::chat::resume_chat_session,
            runtime::chat::interrupt_chat_session,
            runtime::chat::replay_chat_events
        ])
        .run(tauri::generate_context!())
        .expect("无法启动桌面程序");
}
