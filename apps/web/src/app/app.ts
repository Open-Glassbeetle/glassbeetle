import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { invoke, isTauri } from '@tauri-apps/api/core';

import { ApiService, HealthStatus } from './core/api.service';

type ConnectionState = 'checking' | 'online' | 'offline';

@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly apiState = signal<ConnectionState>('checking');
  protected readonly health = signal<HealthStatus | null>(null);
  protected readonly apiError = signal<string | null>(null);

  protected readonly inTauri = signal(isTauri());
  protected readonly name = signal('Glassbeetle');
  protected readonly greeting = signal('');

  ngOnInit(): void {
    this.refreshHealth();
  }

  protected refreshHealth(): void {
    this.apiState.set('checking');
    this.apiError.set(null);

    this.api.getHealth().subscribe({
      next: (health) => {
        this.health.set(health);
        this.apiState.set('online');
      },
      error: (error: unknown) => {
        this.health.set(null);
        this.apiError.set(
          error instanceof Error ? error.message : 'Could not reach the API.',
        );
        this.apiState.set('offline');
      },
    });
  }

  protected async greet(): Promise<void> {
    if (!this.inTauri()) {
      this.greeting.set('Tauri IPC is only available inside the desktop window.');
      return;
    }

    this.greeting.set(await invoke<string>('greet', { name: this.name() }));
  }
}
