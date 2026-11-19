import { LiveAnnouncer } from '@angular/cdk/a11y';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { DesktopService, type ShellAction } from './core/desktop/desktop.service';
import { API_DOCS_URL, REPOSITORY_URL } from './core/links';
import { CapabilitiesService } from './core/platform/capabilities.service';
import { ApiStatusService } from './features/api-status/api-status.service';
import { ThemeService } from './core/theme/theme.service';
import { AgentRosterService } from './core/workspace/agent-roster.service';
import { ConversationsService } from './core/workspace/conversations.service';
import { ModelCatalogService } from './core/workspace/model-catalog.service';
import { UserProfileService } from './core/workspace/user-profile.service';
import { SpendService } from './core/workspace/spend.service';
import { CommandPalette } from './features/command-palette/command-palette';
import { FleetSpine } from './features/chrome/fleet-spine/fleet-spine';
import { FleetStatus } from './features/chrome/fleet-status/fleet-status';
import { WindowControls } from './features/chrome/window-controls/window-controls';
import { SpendMeter } from './features/chrome/spend-meter/spend-meter';
import { ConversationRail } from './features/chrome/conversation-rail/conversation-rail';
import { Avatar } from './shared/ui/avatar';

/** Width at which the rail can sit beside the content instead of over it. */
const WIDE_LAYOUT = '(min-width: 62rem)';

/**
 * The workspace shell: the deck along the top, a persistent rail carrying the
 * conversations, and the routed surface.
 *
 * The conversations live in the rail rather than only on their own page so
 * they are present on every screen. They are the work; everything else in the
 * workspace exists to configure who that work is done with.
 */
@Component({
  selector: 'app-root',
  imports: [
    Avatar,
    ConversationRail,
    FleetSpine,
    FleetStatus,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    SpendMeter,
    WindowControls,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly dialog = inject(MatDialog);
  private readonly mainContent = viewChild<ElementRef<HTMLElement>>('mainContent');

  private readonly roster = inject(AgentRosterService);
  private readonly conversations = inject(ConversationsService);
  private readonly models = inject(ModelCatalogService);
  protected readonly user = inject(UserProfileService);
  private readonly spend = inject(SpendService);
  private readonly capabilities = inject(CapabilitiesService);
  protected readonly desktop = inject(DesktopService);
  private readonly status = inject(ApiStatusService);

  protected readonly wideLayout = toSignal(
    this.breakpoints.observe(WIDE_LAYOUT).pipe(map((state) => state.matches)),
    { initialValue: true },
  );

  protected readonly railOpen = signal(true);

  /**
   * The hit areas that resize an undecorated window.
   *
   * `direction` is Tauri's `ResizeDirection`; `name` only selects the CSS that
   * places the strip.
   */
  protected readonly resizeEdges = [
    { name: 'n', direction: 'North' },
    { name: 's', direction: 'South' },
    { name: 'e', direction: 'East' },
    { name: 'w', direction: 'West' },
    { name: 'ne', direction: 'NorthEast' },
    { name: 'nw', direction: 'NorthWest' },
    { name: 'se', direction: 'SouthEast' },
    { name: 'sw', direction: 'SouthWest' },
  ] as const;

  private hasHandledInitialNavigation = false;

  protected readonly themeMode = this.theme.mode;
  protected readonly themeIcon = computed(() =>
    this.themeMode() === 'dark' ? 'light_mode' : 'dark_mode',
  );

  /**
   * The platform's command key, with its separator.
   *
   * Carries the `+` on Windows and Linux because the word needs one —
   * `Ctrl+K` rather than `CtrlK` — while the macOS glyph reads correctly
   * straight against the letter.
   */
  protected readonly commandKey = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl+';

  constructor() {
    // Follow the window: a rail beside the content is right when there is room
    // and wrong when there is not.
    effect(() => this.railOpen.set(this.wideLayout()));

    // The native menu asks; the shell performs. Every action resolves to the
    // same code path a click in the UI would take, so there is one
    // implementation of each rather than a menu-shaped copy.
    this.desktop.menuActions
      .pipe(takeUntilDestroyed())
      .subscribe((action) => this.runAction(action));

    // The reachability poll runs on its own. When it reports the API back
    // after an outage, the workspace reads that failed while it was away are
    // stale: re-read them once on the transition rather than polling them all
    // continuously, which would be several times the traffic for data that
    // changes when the user changes it. Coming back up from `checking` is
    // startup, not a transition, because `ngOnInit` has already asked.
    let previousState = this.status.state();
    effect(() => {
      const state = this.status.state();

      if (previousState === 'offline' && (state === 'online' || state === 'degraded')) {
        this.refreshWorkspace();
      }

      previousState = state;
    });

    // Reveals the window, which Rust creates hidden so the webview's first
    // paint is never visible as a white flash.
    afterNextRender(() => void this.desktop.signalReady());

    // The desktop window is transparent and the OS blurs what is behind it;
    // the page then tints that glass rather than painting a backdrop of its own.
    document.documentElement.classList.toggle('gb-desktop', this.desktop.isDesktop);

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (!this.wideLayout()) {
          this.railOpen.set(false);
        }

        if (!this.hasHandledInitialNavigation) {
          this.hasHandledInitialNavigation = true;
          return;
        }

        this.mainContent()?.nativeElement.focus();

        let route = this.router.routerState.snapshot.root;
        while (route.firstChild) {
          route = route.firstChild;
        }

        if (route.title) {
          void this.liveAnnouncer.announce(route.title);
        }
      });
  }

  ngOnInit(): void {
    // The shell owns the workspace-wide reads: the deck and the rail show
    // them, and a screen that wanted them again would be fetching what is
    // already on screen.
    this.status.refresh();
    this.refreshWorkspace();
    void this.desktop.connect();
  }

  /** Reads everything the shell holds for the screens below it. */
  private refreshWorkspace(): void {
    this.capabilities.probe();
    this.roster.refresh();
    this.conversations.refresh();
    this.models.refresh();
    this.user.refresh();
    this.spend.refresh();
  }

  /** Carries out a shell action, wherever it was triggered from. */
  private runAction(action: ShellAction): void {
    switch (action) {
      // The create flows are addressable routes rather than dialogs opened
      // from here, which is the same path a link in the rail takes.
      case 'new-chat':
        void this.router.navigate(['/chats/new']);
        break;
      case 'new-agent':
        void this.router.navigate(['/agents'], { queryParams: { new: 1 } });
        break;
      case 'new-memory':
        void this.router.navigate(['/memory'], { queryParams: { new: 1 } });
        break;
      case 'new-prompt':
        void this.router.navigate(['/prompts'], { queryParams: { new: 1 } });
        break;

      case 'go-overview':
        void this.router.navigate(['/overview']);
        break;
      case 'go-agents':
        void this.router.navigate(['/agents']);
        break;
      case 'go-teams':
        void this.router.navigate(['/teams']);
        break;
      case 'go-chats':
        void this.router.navigate(['/chats']);
        break;
      case 'go-projects':
        void this.router.navigate(['/projects']);
        break;
      case 'go-artifacts':
        void this.router.navigate(['/artifacts']);
        break;
      case 'go-memory':
        void this.router.navigate(['/memory']);
        break;
      case 'go-prompts':
        void this.router.navigate(['/prompts']);
        break;

      case 'search':
        this.openPalette();
        break;
      case 'toggle-sidebar':
        this.toggleRail();
        break;
      case 'toggle-theme':
        this.toggleTheme();
        break;

      case 'refresh':
        this.status.refresh();
        this.refreshWorkspace();
        break;

      // The native menu's Help links open through the same command the
      // workspace panel uses, so the URLs live in one place on this side.
      case 'api-docs':
        void this.desktop.openExternal(API_DOCS_URL);
        break;
      case 'repository':
        void this.desktop.openExternal(REPOSITORY_URL);
        break;
    }
  }

  /**
   * Opens the palette on ⌘K / Ctrl-K.
   *
   * Bound on the window rather than on an element so it works wherever focus
   * is, which is the whole point of a command palette. It deliberately does
   * not fire while a dialog is already open.
   */
  @HostListener('window:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (!event.metaKey && !event.ctrlKey) {
      return;
    }

    // A dialog owns the keyboard while it is open; the palette in particular
    // would otherwise reopen on top of itself.
    if (this.dialog.openDialogs.length > 0) {
      return;
    }

    const action = this.shortcutFor(event);
    if (!action) {
      return;
    }

    event.preventDefault();
    this.runAction(action);
  }

  /**
   * Maps a chord to an action.
   *
   * These live here rather than only in the native menu, so they work the same
   * in a browser tab and so the menu documents the keyboard instead of being
   * the only thing that implements it.
   */
  private shortcutFor(event: KeyboardEvent): ShellAction | null {
    const key = event.key.toLowerCase();

    if (event.shiftKey) {
      switch (key) {
        case 'a':
          return 'new-agent';
        case 'm':
          return 'new-memory';
        case 'p':
          return 'new-prompt';
        case 'l':
          return 'toggle-theme';
        default:
          return null;
      }
    }

    switch (key) {
      case 'k':
        return 'search';
      case 'b':
        return 'toggle-sidebar';
      // Starting a conversation is the thing done most, so it gets the key
      // every app gives to "new".
      case 'n':
        return 'new-chat';
      // The digits follow the rail from top to bottom.
      case '1':
        return 'go-chats';
      case '2':
        return 'go-projects';
      case '3':
        return 'go-agents';
      case '4':
        return 'go-artifacts';
      case '5':
        return 'go-teams';
      case '6':
        return 'go-memory';
      case '7':
        return 'go-prompts';
      case '8':
        return 'go-overview';
      default:
        return null;
    }
  }

  protected openPalette(): void {
    this.dialog.open(CommandPalette, {
      panelClass: 'gb-palette-panel',
      width: 'auto',
      autoFocus: 'first-tabbable',
      // Positioned high so the list grows downwards into empty space rather
      // than pushing the input around as results arrive.
      position: { top: '12vh' },
    });
  }

  /**
   * Moves focus into the content, which is what the skip link is for. The
   * browser also jumps to the fragment; focusing here means the next Tab
   * continues from the main region even in webviews that do not focus it.
   */
  protected skipToContent(): void {
    this.mainContent()?.nativeElement.focus();
  }

  protected toggleTheme(): void {
    this.theme.toggle();
  }

  protected startResize(event: MouseEvent, direction: string): void {
    // Only the primary button resizes; a right-click here should fall through
    // to the context menu rather than grabbing the window.
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    void this.desktop.startResize(direction);
  }

  protected toggleRail(): void {
    this.railOpen.update((open) => !open);
  }

  protected closeRailOnNarrow(): void {
    if (!this.wideLayout()) {
      this.railOpen.set(false);
    }
  }
}
