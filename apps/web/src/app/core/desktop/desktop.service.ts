import { Injectable, signal } from '@angular/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { Observable, Subject } from 'rxjs';

/** Mirrors `MENU_EVENT` in `apps/desktop/src-tauri/src/menu.rs`. */
const MENU_EVENT = 'glassbeetle://menu';

/** Emitted once the shell has painted, so Rust can reveal the window. */
const READY_EVENT = 'glassbeetle://ready';

/**
 * Every action the native menu can ask the UI to perform.
 *
 * Keep in step with the item ids in `menu.rs`. The menu only ever *asks*: the
 * implementation of each action lives in the Angular shell, so an action
 * behaves the same whether it came from the menu, a keyboard shortcut or a
 * click in the UI.
 */
export type MenuAction =
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
  private readonly actions = new Subject<MenuAction>();
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
  readonly menuActions: Observable<MenuAction> = this.actions.asObservable();

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
      this.actions.next(event.payload as MenuAction);
    });
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
