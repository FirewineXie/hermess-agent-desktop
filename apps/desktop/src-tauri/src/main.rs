#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod diagnostics;
mod gateway;
mod storage;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(backend::BackendState::default())
        .invoke_handler(tauri::generate_handler![
            diagnostics::probe_local_tools,
            backend::dev_backend_defaults,
            backend::start_dev_backend,
            backend::packed_backend_defaults,
            backend::start_packed_backend,
            backend::ping_backend,
            backend::reconnect_backend,
            backend::stop_backend,
            diagnostics::read_diagnostic_logs,
            diagnostics::record_client_event,
            backend::create_chat_session,
            backend::submit_chat_prompt,
            backend::list_composer_commands,
            backend::execute_composer_command,
            backend::dispatch_composer_skill,
            backend::attach_chat_file,
            backend::detach_chat_image,
            backend::answer_gateway_request,
            backend::list_chat_sessions,
            backend::list_bundled_tools,
            backend::list_agent_toolsets,
            backend::list_active_agent_tools,
            backend::list_model_options,
            backend::select_chat_model,
            backend::get_saved_model_config,
            backend::get_agent_config,
            backend::get_agent_config_schema,
            backend::get_agent_config_raw,
            backend::save_auxiliary_route,
            backend::get_chat_reasoning,
            backend::get_chat_usage,
            backend::list_custom_endpoints,
            backend::load_model_lists,
            backend::save_model_lists,
            backend::add_custom_endpoint,
            backend::delete_custom_endpoint,
            backend::save_agent_config_field,
            backend::save_agent_config_raw,
            backend::check_model_runtime,
            backend::set_default_model,
            backend::resume_chat_session,
            backend::interrupt_chat_session,
            backend::replay_chat_events
        ])
        .run(tauri::generate_context!())
        .expect("无法启动桌面程序");
}
