#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod diagnostics;
mod errors;
mod gateway;
mod panel_terminal;
mod runtime;
mod storage;
mod tray;
mod updates;
mod workspace_panel;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(runtime::BackendState::default())
        .manage(runtime::browser_bridge::BrowserBridgeState::default())
        .manage(runtime::channels::ChannelState::default())
        .manage(panel_terminal::TerminalState::default())
        .setup(tray::setup)
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            diagnostics::probe_local_tools,
            diagnostics::set_frontend_debug_enabled,
            workspace_panel::list_workspace_panel_directory,
            workspace_panel::read_workspace_panel_file,
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
            runtime::profiles::select_profile,
            runtime::profile_data::get_profile_data_directory,
            runtime::profile_data::list_profile_data_directory,
            runtime::profile_data::open_profile_data_directory,
            runtime::personalities::list_personalities,
            runtime::personalities::apply_personality,
            diagnostics::read_diagnostic_logs,
            diagnostics::record_client_event,
            runtime::about::get_product_info,
            updates::check_updates,
            updates::download_update,
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
            runtime::models::get_saved_model_config,
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
            runtime::models::delete_custom_endpoint,
            runtime::config::save_agent_config_field,
            runtime::config::save_agent_config_raw,
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
