import { Injectable, signal } from '@angular/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { Observable, Subject } from 'rxjs';

/** Mirrors `MENU_EVENT` in `apps/desktop/src-tauri/src/menu.rs`. */
const MENU_EVENT = 'glassbeetle://menu';

/** Emitted once the shell has painted, so Rust can reveal the window. */
const READY_EVENT = 'glassbeetle://ready';

/**
 * Every action the shell can be asked to perform.
 *
 * One implementation each, in the shell. The keyboard, the native menu and the
 * workspace panel all route here, so an action behaves identically however it
 * was reached. Ids shared with Rust are kept in step with `menu.rs`.
 */
export type ShellAction =
  | 'new-agent'
  | 'new-memory'
  | 'new-prompt'
  | 'refresh'
  | 'go-overview'
  | 'go-agents'
  | 'go-memory'
  | 'go-prompts'
  | 'search'
  | 'toggle-sidebar'
  | 'toggle-theme';

/**
 * The bridge to the Tauri shell.
 *
 * Deliberately transport-only: it reports what kind of window the app is in
 * and forwards menu actions, but performs none of them. That keeps one
 * implementation per action in the shell rather than a second copy here that
 * could drift.
 *
 * Every method is a no-op outside Tauri, so the same build runs in a plain
 * browser tab during development without branching at each call site.
 */
@Injectable({ providedIn: 'root' })
export class DesktopService {
  private readonly actions = new Subject<ShellAction>();
  private unlisten: UnlistenFn | null = null;

  /** True inside the Tauri window, false in a browser tab. */
  readonly isDesktop = isTauri();

  /**
   * True where the window's own controls are drawn over the app's top bar
   * rather than in a strip above it.
   *
   * macOS only: the window is configured with `titleBarStyle: "Overlay"`, so
   * the traffic lights sit inside our own bar and it has to leave room for
   * them. Windows and Linux keep their native frame and need no inset.
   */
  readonly overlaysTitleBar =
    this.isDesktop && /mac/i.test(navigator.platform || navigator.userAgent);

  /** Menu selections, in the order the user made them. */
  readonly menuActions: Observable<ShellAction> = this.actions.asObservable();

  /** Set once the window has been revealed, for anything that wants to know. */
  readonly revealed = signal(false);

  /**
   * Starts listening for menu events.
   *
   * Safe to call more than once; the second call is ignored rather than
   * registering a second listener that would fire every action twice.
   */
  async connect(): Promise<void> {
    if (!this.isDesktop || this.unlisten) {
      return;
    }

    this.unlisten = await listen<string>(MENU_EVENT, (event) => {
      this.actions.next(event.payload as ShellAction);
    });
  }

  /**
   * The packaged application version, or `null` in a browser tab.
   *
   * Read from the bundle rather than from `package.json`: the number that
   * matters for a bug report is the one the installed app was built with.
   */
  async version(): Promise<string | null> {
    if (!this.isDesktop) {
      return null;
    }

    try {
      return await getVersion();
    } catch {
      return null;
    }
  }

  /**
   * Opens a URL outside the workspace window.
   *
   * Routed through Rust rather than through the opener plugin's JS binding so
   * the scheme is checked on the far side: a frontend able to ask the host to
   * open an arbitrary URL is worth narrowing, and nothing here needs more than
   * http and https.
   */
  async openExternal(url: string): Promise<void> {
    if (!this.isDesktop) {
      window.open(url, '_blank', 'noopener');
      return;
    }

    await invoke('open_external', { url });
  }

  /**
   * Tells the Rust side the UI has painted.
   *
   * The window is created hidden; without this it would stay hidden. A webview
   * shown before its first paint flashes white, which on a dark workspace is
   * visible on every launch.
   */
  async signalReady(): Promise<void> {
    if (!this.isDesktop || this.revealed()) {
      return;
    }

    this.revealed.set(true);
    await emit(READY_EVENT);
  }
}
