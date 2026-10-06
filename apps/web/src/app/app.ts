import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavContent, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { ApiStatusIndicator } from './features/api-status/api-status-indicator';
import { ThemeService } from './core/theme/theme.service';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
}

/**
 * Width at which the navigation drawer can sit beside the content instead of
 * covering it. The Tauri window opens wider than this, so the default desktop
 * experience is the permanent drawer.
 */
const WIDE_LAYOUT = '(min-width: 60rem)';

/**
 * Application shell: toolbar, navigation drawer and the routed outlet.
 *
 * Only features the API actually implements are listed. Chats, projects,
 * teams, providers and analytics exist as empty NestJS modules, so a nav entry
 * for them would lead to a page with nothing to show.
 */
@Component({
  selector: 'app-root',
  imports: [
    ApiStatusIndicator,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTooltipModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  private readonly content = viewChild.required(MatSidenavContent);

  protected readonly navItems: readonly NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: 'space_dashboard' },
    { path: '/agents', label: 'Agents', icon: 'smart_toy' },
    { path: '/memories', label: 'Shared memory', icon: 'hard_drive' },
    { path: '/system-prompts', label: 'System prompts', icon: 'description' },
  ];

  protected readonly wideLayout = toSignal(
    this.breakpoints.observe(WIDE_LAYOUT).pipe(map((state) => state.matches)),
    { initialValue: true },
  );

  protected readonly drawerMode = computed<'side' | 'over'>(() =>
    this.wideLayout() ? 'side' : 'over',
  );

  protected readonly drawerOpen = signal(true);

  protected readonly themeMode = this.theme.mode;
  protected readonly themeIcon = computed(() =>
    this.themeMode() === 'dark' ? 'light_mode' : 'dark_mode',
  );

  constructor() {
    // Follow the window: opening beside the content is right when there is room
    // and wrong when there is not, so resizing resets the drawer rather than
    // leaving an overlay covering a narrow window.
    effect(() => this.drawerOpen.set(this.wideLayout()));

    // The drawer stays put while the routed page scrolls, so the scroll
    // container is `mat-sidenav-content` rather than the document — which is
    // the one the router's own scroll restoration would reset. Without this,
    // opening an agent from halfway down the list lands halfway down its page.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.content().scrollTo({ top: 0, left: 0 }));
  }

  protected toggleTheme(): void {
    this.theme.toggle();
  }

  protected toggleDrawer(): void {
    this.drawerOpen.update((open) => !open);
  }

  /** Closes the overlay drawer after navigating on a narrow window. */
  protected onNavigate(): void {
    if (this.drawerMode() === 'over') {
      this.drawerOpen.set(false);
    }
  }
}
