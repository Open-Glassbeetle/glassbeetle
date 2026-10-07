//! The application menu.
//!
//! The menu is not a generic File/Edit/View scaffold with the app's name on it.
//! Its sections mirror the workspace the Angular app presents — the agents, the
//! context they draw on, and where you are in it — so the two read as one
//! product rather than as a web app with a menu bar bolted on top.
//!
//! Almost every item is a thin front end for something the UI can already do.
//! Rust owns only what the webview genuinely cannot: opening a URL in the
//! system browser, and the native edit and window commands. Everything else is
//! emitted as a [`MENU_EVENT`] and carried out by the Angular shell, so an
//! action behaves identically whether it was reached from the menu, a keyboard
//! shortcut or a click in the UI. There is exactly one implementation of each.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

/// Event carrying a menu action id to the frontend.
pub const MENU_EVENT: &str = "glassbeetle://menu";

/// The API's own interactive documentation, served by the running backend.
const API_DOCS_URL: &str = "http://localhost:3000/api/docs";
const REPOSITORY_URL: &str = "https://github.com/Open-Glassbeetle/glassbeetle";

/// Builds the menu.
///
/// The accelerators deliberately match the ones the Angular shell already
/// binds (⌘K for search, ⌘B for the rail), so the menu documents the keyboard
/// rather than competing with it.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let new_agent = MenuItemBuilder::with_id("new-agent", "New Agent…")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let new_memory = MenuItemBuilder::with_id("new-memory", "New Shared Memory…")
        .accelerator("CmdOrCtrl+Shift+M")
        .build(app)?;
    let new_prompt = MenuItemBuilder::with_id("new-prompt", "New System Prompt…")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", "Refresh Workspace")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    let go_overview = MenuItemBuilder::with_id("go-overview", "Overview")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let go_agents = MenuItemBuilder::with_id("go-agents", "Agents")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let go_memory = MenuItemBuilder::with_id("go-memory", "Shared Memory")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    let go_prompts = MenuItemBuilder::with_id("go-prompts", "System Prompts")
        .accelerator("CmdOrCtrl+4")
        .build(app)?;
    let search = MenuItemBuilder::with_id("search", "Search Workspace…")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;

    let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let toggle_theme = MenuItemBuilder::with_id("toggle-theme", "Toggle Light / Dark")
        .accelerator("CmdOrCtrl+Shift+L")
        .build(app)?;

    let api_docs = MenuItemBuilder::with_id("api-docs", "API Reference").build(app)?;
    let repository = MenuItemBuilder::with_id("repository", "Glassbeetle on GitHub").build(app)?;

    // The application menu is macOS-only; on Windows and Linux its contents
    // belong in the first in-window submenu instead.
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
        .item(&new_memory)
        .item(&new_prompt)
        .separator()
        .item(&refresh);

    // Without an application menu there is nowhere else for Quit to live.
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

    let go = SubmenuBuilder::new(app, "Go")
        .item(&go_overview)
        .item(&go_agents)
        .item(&go_memory)
        .item(&go_prompts)
        .separator()
        .item(&search)
        .build()?;

    #[allow(unused_mut)]
    let mut view = SubmenuBuilder::new(app, "View")
        .item(&toggle_sidebar)
        .item(&toggle_theme)
        .separator()
        .fullscreen();

    #[cfg(debug_assertions)]
    {
        let devtools = MenuItemBuilder::with_id("devtools", "Developer Tools")
            .accelerator("CmdOrCtrl+Alt+I")
            .build(app)?;
        view = view.separator().item(&devtools);
    }

    let view = view.build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&api_docs)
        .item(&repository)
        .build()?;

    let menu = Menu::new(app)?;

    #[cfg(target_os = "macos")]
    menu.append(&app_menu)?;

    menu.append_items(&[&workspace, &edit, &go, &view, &help])?;

    Ok(menu)
}

/// Routes a menu selection.
///
/// Anything the webview cannot do for itself is handled here; everything else
/// is forwarded to the Angular shell, which owns the single implementation of
/// that action.
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
