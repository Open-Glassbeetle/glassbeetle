import { OverlayModule } from '@angular/cdk/overlay';
import {
  Component,
  OnInit,
  booleanAttribute,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';

import { SharedMemoriesService } from '../../../core/api/memories.service';
import { SystemPromptsService } from '../../../core/api/system-prompts.service';
import { DesktopService } from '../../../core/desktop/desktop.service';
import { ThemeService } from '../../../core/theme/theme.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ApiStatusService } from '../../api-status/api-status.service';

/**
 * The workspace control in the window chrome: the product mark, and behind it
 * everything about *this* workspace.
 *
 * Deliberately not a menu. A menu is a list of commands; this answers "what am
 * I connected to, what is in it, and is it healthy" — with live values — and
 * offers the few actions that belong to the workspace as a whole rather than
 * to the screen you are on. That is a panel, so it is built as one.
 */
@Component({
  selector: 'app-workspace-menu',
  imports: [MatIconModule, OverlayModule],
  templateUrl: './workspace-menu.html',
  styleUrl: './workspace-menu.scss',
})
export class WorkspaceMenu implements OnInit {
  private readonly router = inject(Router);
  private readonly memories = inject(SharedMemoriesService);
  private readonly prompts = inject(SystemPromptsService);

  protected readonly status = inject(ApiStatusService);
  protected readonly roster = inject(AgentRosterService);
  protected readonly theme = inject(ThemeService);
  protected readonly desktop = inject(DesktopService);

  protected readonly apiDocsUrl = 'http://localhost:3000/api/docs';
  protected readonly repositoryUrl = 'https://github.com/Open-Glassbeetle/glassbeetle';

  /** The platform's modifiers, so the panel does not promise macOS chords. */
  private readonly mac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
  private readonly cmd = this.mac ? '⌘' : 'Ctrl+';
  private readonly shift = this.mac ? '⇧' : 'Shift+';

  protected readonly createActions = [
    { path: '/agents', label: 'Agent', icon: 'graph_3', key: `${this.cmd}N` },
    {
      path: '/memory',
      label: 'Shared memory',
      icon: 'database',
      key: `${this.cmd}${this.shift}M`,
    },
    {
      path: '/prompts',
      label: 'System prompt',
      icon: 'article',
      key: `${this.cmd}${this.shift}P`,
    },
  ];

  /**
   * Drops the trigger's own border and fill, for when it is placed inside a
   * capsule that already provides them.
   */
  readonly flush = input(false, { transform: booleanAttribute });

  protected readonly open = signal(false);
  protected readonly version = signal<string | null>(null);
  protected readonly memoryCount = signal<number | null>(null);
  protected readonly promptCount = signal<number | null>(null);

  protected readonly uptime = computed(() => {
    const seconds = this.status.health()?.uptimeSeconds;
    return seconds === undefined ? '—' : formatUptime(seconds);
  });

  ngOnInit(): void {
    void this.loadVersion();
  }

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);

    // Counts are read when the panel opens rather than kept live: they are
    // reference information someone asks for, not something to poll for while
    // it is not on screen.
    if (next) {
      this.loadCounts();
    }
  }

  protected close(): void {
    this.open.set(false);
  }

  protected go(path: string, queryParams?: Record<string, unknown>): void {
    this.close();
    void this.router.navigate([path], queryParams ? { queryParams } : {});
  }

  /**
   * Opens a URL outside the workspace window.
   *
   * In the desktop app this goes through Rust, which hands it to the system
   * browser; replacing the workspace window's contents with a web page would
   * be a one-way trip. In a browser tab the platform already does the right
   * thing with a new tab.
   */
  protected openExternal(url: string): void {
    this.close();

    if (this.desktop.isDesktop) {
      void this.desktop.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  private async loadVersion(): Promise<void> {
    this.version.set(await this.desktop.version());
  }

  private loadCounts(): void {
    forkJoin({
      memories: this.memories.list({ limit: 1 }).pipe(
        map((page) => page.total),
        catchError(() => of(null)),
      ),
      prompts: this.prompts.list({ limit: 1 }).pipe(
        map((page) => page.total),
        catchError(() => of(null)),
      ),
    }).subscribe(({ memories, prompts }) => {
      this.memoryCount.set(memories);
      this.promptCount.set(prompts);
    });
  }
}

/** Renders a second count as the largest sensible unit, e.g. "2h 5m". */
function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
