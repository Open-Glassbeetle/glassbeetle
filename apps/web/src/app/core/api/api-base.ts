import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';

import { environment } from '../../../environments/environment';

/**
 * Base for the resource services.
 *
 * The base URL is absolute and comes from the environment: a packaged Tauri app
 * is served from `tauri://localhost`, so a relative `/api` would resolve
 * against the custom protocol instead of the NestJS server.
 */
export abstract class ApiClient {
  protected readonly http = inject(HttpClient);
  protected readonly baseUrl = environment.apiBaseUrl;

  /** Builds an absolute URL for a path below `/api/v1`. */
  protected url(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}
