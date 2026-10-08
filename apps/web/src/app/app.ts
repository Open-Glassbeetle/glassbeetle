import { BreakpointObserver } from '@angular/cdk/layout';
import {
  Component,
  HostListener,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { readinessOf } from './core/agents/agent-readiness';
import { DesktopService, type ShellAction } from './core/desktop/desktop.service';
import { CapabilitiesService } from './core/platform/capabilities.service';
import { ApiStatusService } from './features/api-status/api-status.service';
import { ThemeService } from './core/theme/theme.service';
import { AgentRosterService } from './core/workspace/agent-roster.service';
import { UserProfileService } from './core/workspace/user-profile.service';
import { SpendService } from './core/workspace/spend.service';
import { CommandPalette } from './features/command-palette/command-palette';
import { FleetSpine } from './features/chrome/fleet-spine/fleet-spine';
import { FleetStatus } from './features/chrome/fleet-status/fleet-status';
import { WindowControls } from './features/chrome/window-controls/window-controls';
import { SpendMeter } from './features/chrome/spend-meter/spend-meter';
import { WorkspaceMenu } from './features/chrome/workspace-menu/workspace-menu';
import { AgentAvatar } from './features/agents/agent-avatar/agent-avatar';
import { Avatar } from './shared/ui/avatar';
import { ReadinessBadge } from './shared/ui/readiness-badge';
import { Skeleton } from './shared/ui/skeleton';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
  /** The digit this surface answers to, with the platform's command key. */
  readonly shortcut: string;
}

interface Crumb {
  readonly label: string;
  readonly path: string;
}

/** Width at which the rail can sit beside the content instead of over it. */
const WIDE_LAYOUT = '(min-width: 62rem)';

/**
 * The workspace shell: a top bar, a persistent rail carrying both navigation
 * and the agent roster, and the routed surface.
 *
 * The roster lives in the rail rather than only on the agents page so the
 * agents are present on every screen — they are the actors the workspace is
 * about, not one section of it.
 */
@Component({
  selector: 'app-root',
  imports: [
    AgentAvatar,
    Avatar,
    FleetSpine,
    FleetStatus,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
    ReadinessBadge,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    Skeleton,
    SpendMeter,
    WindowControls,
    WorkspaceMenu,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  protected readonly roster = inject(AgentRosterService);
  protected readonly user = inject(UserProfileService);
  private readonly spend = inject(SpendService);
  private readonly capabilities = inject(CapabilitiesService);
  protected readonly desktop = inject(DesktopService);
  private readonly status = inject(ApiStatusService);

  protected readonly navItems: readonly NavItem[] = [
    { path: '/overview', label: 'Overview', icon: 'space_dashboard', shortcut: '1' },
    { path: '/agents', label: 'Agents', icon: 'graph_3', shortcut: '2' },
    { path: '/memory', label: 'Shared memory', icon: 'database', shortcut: '3' },
    { path: '/prompts', label: 'System prompts', icon: 'article', shortcut: '4' },
  ];

  /**
   * Surfaces reached from the window chrome rather than from the rail.
   *
   * The trail names where you are, so it has to know about them — otherwise
   * the profile reads as "Workspace", which is the fallback for a route the
   * chrome does not recognise.
   */
  private readonly chromeSurfaces: readonly Crumb[] = [
    { label: 'Profile', path: '/profile' },
    { label: 'Spending', path: '/budget' },
  ];

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

  /** The current URL, so the trail recomputes on every navigation. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Where the user is, in the workspace's own words.
   *
   * An agent's trail shows its name rather than its id, resolved from the
   * roster the rail has already loaded — which is the one thing a title bar is
   * genuinely for, and what makes the chrome feel part of the app rather than
   * a frame around it.
   */
  protected readonly trail = computed<readonly Crumb[]>(() => {
    const url = this.url().split('?')[0] ?? '';
    const segments = url.split('/').filter(Boolean);

    if (segments.length === 0) {
      return [{ label: 'Overview', path: '/overview' }];
    }

    const root = `/${segments[0]}`;
    const item =
      this.navItems.find((entry) => entry.path === root) ??
      this.chromeSurfaces.find((entry) => entry.path === root);
    const head: Crumb = {
      label: item?.label ?? 'Workspace',
      path: item?.path ?? '/overview',
    };

    if (segments[0] !== 'agents' || segments.length < 2) {
      return [head];
    }

    const agentId = segments[1]!;
    const agent = this.roster.agents().find((entry) => entry.id === agentId);

    return [head, { label: agent?.name ?? 'Agent', path: url }];
  });

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

  protected readonly rosterEntries = computed(() => {
    const context = { modelsAvailable: this.capabilities.modelsAvailable() };

    return this.roster.agents().map((agent) => ({
      agent,
      readiness: readinessOf(agent, context),
    }));
  });

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

    // Reveals the window, which Rust creates hidden so the webview's first
    // paint is never visible as a white flash.
    afterNextRender(() => void this.desktop.signalReady());

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (!this.wideLayout()) {
          this.railOpen.set(false);
        }
      });
  }

  ngOnInit(): void {
    // The shell owns the workspace-wide reads: the deck shows all three, and a
    // screen that wanted them again would be fetching what is already on
    // screen.
    this.status.refresh();
    this.capabilities.probe();
    this.roster.refresh();
    this.user.refresh();
    this.spend.refresh();
    void this.desktop.connect();
  }

  /** Carries out a shell action, wherever it was triggered from. */
  private runAction(action: ShellAction): void {
    switch (action) {
      // The create flows are addressable routes rather than dialogs opened
      // from here, which is the same path the rail's "New agent" takes.
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
        this.capabilities.probe();
        this.roster.refresh();
        this.user.refresh();
        this.spend.refresh();
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
      case 'n':
        return 'new-agent';
      case '1':
        return 'go-overview';
      case '2':
        return 'go-agents';
      case '3':
        return 'go-memory';
      case '4':
        return 'go-prompts';
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
