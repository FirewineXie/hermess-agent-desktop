use crate::errors::DesktopFailure;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn panel_browser_action(
    app: AppHandle,
    id: String,
    action: String,
) -> Result<(), DesktopFailure> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(DesktopFailure::invalid_input());
    }
    let script = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err(DesktopFailure::invalid_input()),
    };
    app.get_webview(&format!("panel-{id}"))
        .ok_or_else(DesktopFailure::invalid_input)?
        .eval(script)
        .map_err(|_| DesktopFailure::operation_failed())
}
