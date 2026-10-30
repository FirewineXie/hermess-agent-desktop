use crate::errors::DesktopFailure;

#[cfg(target_os = "windows")]
mod windows_notification {
    use super::DesktopFailure;
    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use tauri_winrt_notification::Toast;
    use windows_registry::CURRENT_USER;

    const APP_ID: &str = "com.hermess.agentdesktop";
    const APP_NAME: &str = "Hermess Agent Desktop";

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NativeNotificationAction {
        id: i32,
        action_id: String,
    }

    fn register_app_identity() -> Result<(), DesktopFailure> {
        let key = CURRENT_USER
            .create(format!(r"SOFTWARE\Classes\AppUserModelId\{APP_ID}"))
            .map_err(|_| DesktopFailure::operation_failed())?;
        key.set_string("DisplayName", APP_NAME)
            .map_err(|_| DesktopFailure::operation_failed())?;
        key.set_string("IconBackgroundColor", "0")
            .map_err(|_| DesktopFailure::operation_failed())?;
        if let Ok(executable) = std::env::current_exe() {
            key.set_string(
                "IconUri",
                crate::paths::plain_path(&executable)
                    .to_string_lossy()
                    .as_ref(),
            )
            .map_err(|_| DesktopFailure::operation_failed())?;
        }
        Ok(())
    }

    pub(super) fn show(
        app: AppHandle,
        id: i32,
        title: String,
        body: String,
        approval_locale: Option<String>,
    ) -> Result<(), DesktopFailure> {
        register_app_identity()?;
        let callback_app = app.clone();
        let mut toast = Toast::new(APP_ID)
            .title(&title)
            .text1(&body)
            .on_activated(move |action| {
                let _ = callback_app.emit(
                    "native-notification-action",
                    NativeNotificationAction {
                        id,
                        action_id: action.unwrap_or_else(|| "tap".to_owned()),
                    },
                );
                Ok(())
            });
        if let Some(locale) = approval_locale {
            let (approve, deny) = if locale == "zh-CN" {
                ("允许一次", "拒绝")
            } else {
                ("Allow once", "Reject")
            };
            toast = toast
                .add_button(approve, "approve")
                .add_button(deny, "deny");
        }
        toast.show().map_err(|_| DesktopFailure::operation_failed())
    }
}

#[tauri::command]
pub fn show_native_notification(
    app: tauri::AppHandle,
    id: i32,
    title: String,
    body: String,
    approval_locale: Option<String>,
) -> Result<(), DesktopFailure> {
    #[cfg(target_os = "windows")]
    {
        return windows_notification::show(app, id, title, body, approval_locale);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, id, title, body, approval_locale);
        Err(DesktopFailure::operation_failed())
    }
}
