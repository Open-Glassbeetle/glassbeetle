mod menu;

use std::time::Duration;

use tauri::{AppHandle, Listener, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

/// The workspace window's label, as declared in `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";

/// Emitted by the Angular shell once it has painted.
const READY_EVENT: &str = "glassbeetle://ready";

/// How long to wait for that before showing the window regardless.
const READY_TIMEOUT: Duration = Duration::from_secs(4);

/// Shows and focuses the workspace window.
fn reveal<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Opens a URL in the user's browser on the frontend's behalf.
///
/// The scheme is checked here rather than trusted from the webview. The
/// frontend only ever needs to open documentation and the repository, and a
/// command that hands the host any string it is given is a wider door than
/// this app has a use for.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http and https URLs can be opened".into());
    }

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            app.set_menu(menu::build(app.handle())?)?;

            // The window is created hidden and revealed once the frontend
            // reports it has painted. A webview shown while still blank is a
            // white rectangle for a moment, which on a dark workspace reads as
            // a flash on every launch.
            let on_ready = app.handle().clone();
            app.once(READY_EVENT, move |_| {
                log::info!("frontend ready; revealing the window");
                reveal(&on_ready);
            });

            // A window that is hidden until the frontend asks for it is only
            // ever as reliable as the frontend. If the dev server is down, the
            // bundle fails to boot or the event is lost, the app would sit
            // there as a process with nothing on screen and no way to tell
            // what went wrong. After the grace period it is shown regardless:
            // a window displaying an error beats no window at all.
            let fallback = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(READY_TIMEOUT);

                if let Some(window) = fallback.get_webview_window(MAIN_WINDOW) {
                    if !window.is_visible().unwrap_or(true) {
                        log::warn!(
                            "frontend did not report ready within {READY_TIMEOUT:?}; \
                             showing the window anyway"
                        );
                        reveal(&fallback);
                    }
                }
            });

            Ok(())
        })
        .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![open_external])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
