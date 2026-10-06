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
import { DesktopService, type MenuAction } from './core/desktop/desktop.service';
import { CapabilitiesService } from './core/platform/capabilities.service';
import { ThemeService } from './core/theme/theme.service';
import { AgentRosterService } from './core/workspace/agent-roster.service';
import { ApiStatusIndicator } from './features/api-status/api-status-indicator';
import { CommandPalette } from './features/command-palette/command-palette';
import { AgentAvatar } from './features/agents/agent-avatar/agent-avatar';
import { ReadinessBadge } from './shared/ui/readiness-badge';
import { Skeleton } from './shared/ui/skeleton';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
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
    ApiStatusIndicator,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
    ReadinessBadge,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    Skeleton,
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
  private readonly capabilities = inject(CapabilitiesService);
  protected readonly desktop = inject(DesktopService);

  protected readonly navItems: readonly NavItem[] = [
    { path: '/overview', label: 'Overview', icon: 'space_dashboard' },
    { path: '/agents', label: 'Agents', icon: 'graph_3' },
    { path: '/memory', label: 'Shared memory', icon: 'database' },
    { path: '/prompts', label: 'System prompts', icon: 'article' },
  ];

  protected readonly wideLayout = toSignal(
    this.breakpoints.observe(WIDE_LAYOUT).pipe(map((state) => state.matches)),
    { initialValue: true },
  );

  protected readonly railOpen = signal(true);

  protected readonly themeMode = this.theme.mode;
  protected readonly themeIcon = computed(() =>
    this.themeMode() === 'dark' ? 'light_mode' : 'dark_mode',
  );

  /** Shown on the ⌘K affordance so the hint matches the user's keyboard. */
  protected readonly commandKey = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl';

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
      .subscribe((action) => this.runMenuAction(action));

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
    this.capabilities.probe();
    this.roster.refresh();
    void this.desktop.connect();
  }

  /** Carries out a selection from the native menu. */
  private runMenuAction(action: MenuAction): void {
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
        this.capabilities.probe();
        this.roster.refresh();
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
    const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';

    if (isPaletteShortcut && this.dialog.openDialogs.length === 0) {
      event.preventDefault();
      this.openPalette();
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

  protected toggleRail(): void {
    this.railOpen.update((open) => !open);
  }

  protected closeRailOnNarrow(): void {
    if (!this.wideLayout()) {
      this.railOpen.set(false);
    }
  }
}
