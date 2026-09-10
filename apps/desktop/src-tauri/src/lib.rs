/// Example IPC command, callable from the Angular app via
/// `invoke('greet', { name })` from `@tauri-apps/api/core`.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! This came from Rust.")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
