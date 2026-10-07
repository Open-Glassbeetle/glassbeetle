//! The native menu.
//!
//! Deliberately small. Product navigation lives in the deck — the app's own
//! window chrome — where it can show live state that a menu cannot: how much of
//! the fleet is configured, which agents need attention, whether the backend is
//! answering. Rebuilding that as a tree of labels would be a worse copy of
//! something the user can already see.
//!
//! So this menu keeps what the operating system owns and the webview cannot
//! provide for itself: the application menu macOS expects, clipboard and undo
//! for text fields, window commands, and the two links that belong in the
//! system browser rather than in the workspace window.
//!
//! The few items that *are* product actions exist because macOS users look for
//! them in the menu bar, and they emit [`MENU_EVENT`] rather than implementing
//! anything — the Angular shell owns the one implementation, which the keyboard
//! and the workspace panel reach too.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

/// Event carrying an action id to the frontend.
pub const MENU_EVENT: &str = "glassbeetle://menu";

/// The API's own interactive documentation, served by the running backend.
const API_DOCS_URL: &str = "http://localhost:3000/api/docs";
const REPOSITORY_URL: &str = "https://github.com/Open-Glassbeetle/glassbeetle";

/// Builds the menu.
///
/// Accelerators match what the shell already binds, so the menu reflects the
/// keyboard rather than competing with it.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let new_agent = MenuItemBuilder::with_id("new-agent", "New Agent…")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let search = MenuItemBuilder::with_id("search", "Search Workspace…")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;

    let api_docs = MenuItemBuilder::with_id("api-docs", "API Reference").build(app)?;
    let repository = MenuItemBuilder::with_id("repository", "Source Repository").build(app)?;

    // The application menu is macOS-only. Elsewhere Quit belongs in the first
    // in-window submenu instead.
    #[cfg(target_os = "macos")]
    let app_menu = {
        let about = AboutMetadataBuilder::new()
            .name(Some("Glassbeetle"))
            .version(Some(env!("CARGO_PKG_VERSION")))
            .comments(Some(
                "A local-first workspace for configuring and running AI agents.",
            ))
            .website(Some(REPOSITORY_URL))
            .build();

        SubmenuBuilder::new(app, "Glassbeetle")
            .about(Some(about))
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?
    };

    #[allow(unused_mut)]
    let mut workspace = SubmenuBuilder::new(app, "Workspace")
        .item(&new_agent)
        .item(&search)
        .separator()
        .item(&toggle_sidebar);

    #[cfg(not(target_os = "macos"))]
    {
        workspace = workspace.separator().quit();
    }

    let workspace = workspace.build()?;

    // Without these the standard text shortcuts do nothing in the webview's
    // input fields — the single clearest way an app can feel like a web page in
    // a window rather than a desktop application.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    #[allow(unused_mut)]
    let mut window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .fullscreen()
        .separator()
        .close_window();

    #[cfg(debug_assertions)]
    {
        let devtools = MenuItemBuilder::with_id("devtools", "Developer Tools")
            .accelerator("CmdOrCtrl+Alt+I")
            .build(app)?;
        window = window.separator().item(&devtools);
    }

    let window = window.build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&api_docs)
        .item(&repository)
        .build()?;

    let menu = Menu::new(app)?;

    #[cfg(target_os = "macos")]
    menu.append(&app_menu)?;

    menu.append_items(&[&workspace, &edit, &window, &help])?;

    Ok(menu)
}

/// Routes a menu selection.
///
/// Anything the webview cannot do for itself is handled here; everything else
/// is forwarded to the Angular shell, which owns the single implementation.
pub fn handle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "api-docs" => open(app, API_DOCS_URL),
        "repository" => open(app, REPOSITORY_URL),

        #[cfg(debug_assertions)]
        "devtools" => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }

        action => {
            if let Err(error) = app.emit(MENU_EVENT, action) {
                log::error!("could not deliver menu action '{action}': {error}");
            }
        }
    }
}

/// Opens a URL in the user's browser rather than in the app's own window.
///
/// The workspace window is the product; replacing its contents with a web page
/// would be a one-way trip with no way back to where the user was.
fn open<R: Runtime>(app: &AppHandle<R>, url: &str) {
    if let Err(error) = app.opener().open_url(url, None::<&str>) {
        log::error!("could not open {url}: {error}");
    }
}
