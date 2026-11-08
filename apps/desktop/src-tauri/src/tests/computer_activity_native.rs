//! Explicit native harness, isolated from product profiles and running Hermes installations.
use super::*;
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
struct Report(StdMutex<Vec<String>>);

#[tauri::command]
fn activity_test_report(app: AppHandle, text: String) {
    app.state::<Report>().0.lock().unwrap().push(text);
}

#[test]
#[ignore = "Windows native WebView/IPC harness; requires production preview at http://127.0.0.1:1438"]
fn native_banner_uses_real_ipc_and_does_not_take_focus() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = format!(
        "com.hermess.computer-test-{}",
        uuid::Uuid::new_v4().simple()
    );
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1438".parse().unwrap());
    let failure = Arc::new(StdMutex::new(None));
    let result = failure.clone();
    let app = tauri::Builder::default().any_thread()
        .manage(ComputerActivityState::default()).manage(Report::default())
        .invoke_handler(tauri::generate_handler![get_computer_activity, stop_computer_activity, activity_test_report])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "focus-fixture", WebviewUrl::App("computer-activity.html".into()))
                .title("Hermess computer activity test").inner_size(600.0, 200.0).focused(true).build()?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let check = async {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    let (a, mut receiver_a) = mpsc::channel(1);
                    let (b, mut receiver_b) = mpsc::channel(1);
                    start(&handle, Key { connection:"native-a".into(), session:"a".into(), generation:1 }, "click", Stop::Codex(a));
                    start(&handle, Key { connection:"native-b".into(), session:"b".into(), generation:1 }, "type", Stop::Codex(b));
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    let banner = handle.get_webview_window(window::LABEL).ok_or("banner missing")?;
                    if !banner.is_visible().unwrap_or(false) { return Err("banner hidden"); }
                    let hwnd = banner.hwnd().map_err(|_| "banner has no native handle")?;
                    if unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() } == hwnd.0 as _ { return Err("banner stole foreground focus"); }
                    banner.eval("(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('get_computer_activity');await window.__TAURI_INTERNALS__.invoke('activity_test_report',{text:JSON.stringify({text:document.querySelector('.computer-activity-label')?.textContent,phase:s.phase})});document.querySelector('button').click()})()")
                        .map_err(|_| "eval failed")?;
                    for receiver in [&mut receiver_a, &mut receiver_b] {
                        let signal = tokio::time::timeout(Duration::from_secs(8), receiver.recv()).await.map_err(|_| "button IPC did not stop both targets")?;
                        if signal != Some(json!({"kind":"stop"})) { return Err("wrong stop signal"); }
                    }
                    process_finished(&handle, "native-a", true);
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    if !banner.is_visible().unwrap_or(false) { return Err("one completed task hid another"); }
                    process_finished(&handle, "native-b", true);
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    if banner.is_visible().unwrap_or(true) { return Err("confirmed cleanup did not hide banner"); }
                    let reports = handle.state::<Report>();
                    let reports = reports.0.lock().unwrap();
                    let report: Value = serde_json::from_str(reports.last().ok_or("missing DOM report")?).map_err(|_| "bad report")?;
                    if report["text"] != "hermess  agent desktop 正在操作电脑" || report["phase"] != "active" { return Err("incorrect banner content or IPC state"); }
                    Ok::<_, &'static str>(())
                };
                let outcome = tokio::time::timeout(Duration::from_secs(22), check).await;
                *result.lock().unwrap() = Some(outcome);
                handle.exit(0);
            });
            Ok(())
        }).build(context).unwrap();
    app.run_return(|_, _| {});
    assert!(
        matches!(*failure.lock().unwrap(), Some(Ok(Ok(())))),
        "native result: {:?}",
        *failure.lock().unwrap()
    );
}
