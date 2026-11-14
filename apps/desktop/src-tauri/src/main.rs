#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use crate::paths::plain_path;
use tauri::Manager;

mod chat_windows;
mod computer_activity;
mod device;
mod device_power;
mod diagnostics;
mod errors;
mod gateway;
mod notifications;
mod panel_terminal;
mod paths;
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
        .register_asynchronous_uri_scheme_protocol(
            "hermess-media",
            |context, request, responder| {
                runtime::media::handle_protocol(
                    context.app_handle().clone(),
                    context.webview_label().to_owned(),
                    request,
                    responder,
                );
            },
        )
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if !computer_activity::handle_shortcut(app, shortcut) {
                            quick_input::show(app);
                        }
                    }
                })
                .build(),
        )
        .manage(device::DeviceState::default())
        .manage(computer_activity::ComputerActivityState::default())
        .manage(quick_input::QuickState::default())
        .manage(chat_windows::ChatWindowState::default())
        .manage(runtime::BackendState::default())
        .manage(runtime::coding::CodingState::default())
        .manage(runtime::coding_runtime::CodingRuntimeState::default())
        .manage(runtime::media::MediaResources::default())
        .manage(runtime::dashboard_plugins::DashboardPluginSockets::default())
        .manage(runtime::console_socket::ConsoleSockets::default())
        .manage(runtime::kanban_dashboard::KanbanEventStreams::default())
        .manage(runtime::browser_bridge::BrowserBridgeState::default())
        .manage(runtime::channels::ChannelState::default())
        .manage(runtime::channel_telegram::TelegramSetupState::default())
        .manage(runtime::channel_vendor_qr::VendorQrState::default())
        .manage(runtime::channel_whatsapp::WhatsAppSetupState::default())
        .manage(panel_terminal::TerminalState::default())
        .manage(updates::UpdateDownloadState::default())
        .setup(|app| {
            if let Some(storage) =
                runtime::existing_client_log_storage(app.handle()).or_else(|| {
                    app.path()
                        .app_local_data_dir()
                        .ok()
                        .map(|path| plain_path(&path).join("HermessAgentDesktop"))
                })
            {
                diagnostics::set_client_log_storage(storage);
            }
            runtime::storage_settings::initialize(app.handle())?;
            if let Some(storage) = runtime::existing_client_log_storage(app.handle()) {
                diagnostics::set_client_log_storage(storage);
            }
            runtime::coding::start_config_audit(app.handle().clone());
            process_manager::ProcessManager::init()?;
            tray::setup(app)?;
            device::setup(app.handle())?;
            computer_activity::setup(app.handle());
            webview_cache::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                runtime::media::release_window(window.app_handle(), window.label());
            }
            tray::on_window_event(window, event);
            computer_activity::on_window_event(window, event);
            chat_windows::on_window_event(window, event);
        })
        .invoke_handler(tauri::generate_handler![
            computer_activity::get_computer_activity,
            computer_activity::stop_computer_activity,
            runtime::coding::get_coding_config,
            runtime::coding_providers::coding_provider_request,
            runtime::coding_runtime::get_coding_runtime,
            runtime::coding_runtime::install_coding_runtime,
            runtime::coding::save_coding_config,
            runtime::coding::coding_session_request,
            device::get_device_status,
            device::save_device_preferences,
            quick_input::set_quick_target,
            quick_input::get_quick_target,
            quick_input::submit_quick_input,
            quick_input::take_quick_submission,
            quick_input::finish_quick_submission,
            chat_windows::open_chat_window,
            chat_windows::get_chat_window_context,
            runtime::delegation::get_delegation_routing,
            runtime::delegation::save_delegation_routing,
            runtime::delegation::save_delegation_model,
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
            runtime::media::prepare_chat_media,
            runtime::media::preview_chat_media,
            runtime::media::save_chat_media,
            runtime::media::reveal_chat_media,
            runtime::media::release_chat_media,
            panel_terminal::start_panel_terminal,
            panel_terminal::activate_panel_terminal,
            panel_terminal::write_panel_terminal,
            panel_terminal::resize_panel_terminal,
            panel_terminal::close_panel_terminal,
            runtime::dev_backend_defaults,
            runtime::start_dev_backend,
            runtime::packed_backend_defaults,
            runtime::storage_settings::storage_location_request,
            runtime::start_packed_backend,
            runtime::ping_backend,
            runtime::reconnect_backend,
            runtime::restart_backend_gracefully,
            runtime::stop_backend,
            runtime::web_access::web_access_request,
            runtime::remote_gateway::test_remote_gateway,
            runtime::remote_gateway::saved_remote_gateway,
            runtime::remote_sidebar::gateway_sidebar_sessions,
            runtime::remote_gateway::save_remote_gateway,
            runtime::remote_gateway::delete_remote_gateway,
            runtime::remote_gateway::active_gateway,
            runtime::remote_gateway::activate_saved_remote_gateway,
            runtime::remote_gateway::activate_local_gateway,
            runtime::profiles::list_profiles,
            runtime::profiles::create_profile,
            runtime::profile_archive::export_profile_archive,
            runtime::profile_archive::import_profile_archive,
            runtime::profiles::delete_profile,
            runtime::profiles::set_profile_display_name,
            runtime::profile_identity::rename_profile_id,
            runtime::profile_identity::get_profile_identity,
            runtime::profile_identity::get_profile_setup_command,
            runtime::profile_identity::save_profile_description,
            runtime::profile_identity::describe_profile_auto,
            runtime::workbuddy_import::inspect_workbuddy_import,
            runtime::workbuddy_import::import_workbuddy_package,
            runtime::profiles::activate_profile,
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
            runtime::channel_manage::channel_save,
            runtime::channel_manage::channel_test,
            runtime::channel_telegram::channel_telegram_start,
            runtime::channel_telegram::channel_telegram_poll,
            runtime::channel_telegram::channel_telegram_apply,
            runtime::channel_telegram::channel_telegram_cancel,
            runtime::channel_vendor_qr::channel_vendor_qr_start,
            runtime::channel_vendor_qr::channel_vendor_qr_poll,
            runtime::channel_vendor_qr::channel_vendor_qr_apply,
            runtime::channel_vendor_qr::channel_vendor_qr_cancel,
            runtime::channel_whatsapp::channel_whatsapp_start,
            runtime::channel_whatsapp::channel_whatsapp_poll,
            runtime::channel_whatsapp::channel_whatsapp_apply,
            runtime::channel_whatsapp::channel_whatsapp_cancel,
            runtime::channels::channel_qr_start,
            runtime::channels::channel_qr_poll,
            runtime::channels::channel_pairing_approve,
            runtime::channels::channel_qr_cancel,
            runtime::chat::create_chat_session,
            runtime::bots::list_bots,
            runtime::bots::open_bot_chat,
            runtime::bots::bot_groups_request,
            runtime::chat::submit_chat_prompt,
            runtime::chat::list_composer_commands,
            runtime::chat::execute_composer_command,
            runtime::chat_subagents::list_chat_subagents,
            runtime::chat_subagents::read_chat_subagent_tail,
            runtime::chat_subagents::steer_chat_subagent,
            runtime::chat_subagents::stop_chat_subagent,
            runtime::chat_rollback::list_chat_rollback_checkpoints,
            runtime::chat_rollback::diff_chat_rollback_checkpoint,
            runtime::chat_rollback::restore_chat_rollback_checkpoint,
            runtime::session_export::export_chat_session,
            runtime::chat::dispatch_composer_skill,
            runtime::chat::attach_chat_file,
            runtime::chat::attach_chat_image_bytes,
            runtime::chat::inspect_chat_file,
            runtime::chat::detach_chat_image,
            runtime::chat::answer_gateway_request,
            runtime::chat_connections::chat_connection,
            runtime::chat::list_chat_sessions,
            runtime::chat::delete_chat_session,
            runtime::tools::list_bundled_tools,
            runtime::tools::list_profile_toolsets,
            runtime::downloadable_tools::list_downloadable_tools,
            runtime::downloadable_tools::install_downloadable_tool,
            runtime::usage::get_usage_statistics,
            runtime::system_stats::get_system_stats,
            runtime::usage::get_model_usage_statistics,
            runtime::extensions::extension_request,
            runtime::personal_tasks::personal_task_request,
            runtime::kanban_dashboard::kanban_dashboard_request,
            runtime::dashboard_plugins::dashboard_plugin_socket_subscribe,
            runtime::dashboard_plugins::dashboard_plugin_socket_send,
            runtime::dashboard_plugins::dashboard_plugin_socket_unsubscribe,
            runtime::console_socket::console_socket_subscribe,
            runtime::console_socket::console_socket_send,
            runtime::console_socket::console_socket_unsubscribe,
            runtime::kanban_dashboard::kanban_dashboard_subscribe,
            runtime::kanban_dashboard::kanban_dashboard_unsubscribe,
            runtime::models::list_model_options,
            runtime::model_oauth::list_model_oauth_providers,
            runtime::model_oauth::start_model_oauth,
            runtime::model_oauth::poll_model_oauth,
            runtime::model_oauth::cancel_model_oauth,
            runtime::model_oauth::disconnect_model_oauth,
            runtime::models::select_chat_model,
            runtime::models::get_moa_config,
            runtime::models::save_moa_config,
            runtime::models::get_saved_model_config,
            runtime::security::get_shared_metrics_consent,
            runtime::security::save_shared_metrics_consent,
            runtime::security::get_checkpoint_inventory,
            runtime::config::get_agent_config,
            runtime::config::get_agent_config_schema,
            runtime::config::get_agent_config_defaults,
            runtime::config::get_agent_config_raw,
            runtime::config::get_auxiliary_models,
            runtime::config::save_auxiliary_route,
            runtime::config::reset_auxiliary_models,
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
            runtime::config::save_agent_config,
            runtime::config::save_agent_config_raw,
            runtime::config::import_agent_config_json,
            runtime::config::export_agent_config_json,
            runtime::memory_provider::get_memory_providers,
            runtime::memory_provider::get_memory_provider_config,
            runtime::memory_provider::save_memory_provider_config,
            runtime::memory_provider::start_memory_provider_oauth,
            runtime::memory_provider::get_memory_provider_oauth_status,
            runtime::personal_files::read_personal_file,
            runtime::personal_files::save_personal_file,
            runtime::personal_files::reset_personal_memory,
            runtime::models::check_model_runtime,
            runtime::models::set_default_model,
            runtime::chat::resume_chat_session,
            runtime::chat_history::mutate_chat_history,
            runtime::chat::interrupt_chat_session,
            runtime::composer_steer::steer_chat_session,
            runtime::composer_side_question::ask_side_question,
            runtime::composer_background::start_background_task,
            runtime::chat::replay_chat_events
        ])
        .run(tauri::generate_context!())
        .expect("无法启动桌面程序");
}
