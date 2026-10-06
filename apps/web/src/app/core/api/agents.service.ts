import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import { toHttpParams } from './http-params';
import type { Agent, AgentListQuery, CreateAgentInput, UpdateAgentInput } from './agents.models';
import type { PaginatedResponse } from './pagination';

/** `/api/v1/agents` — the agent resource and its profile picture. */
@Injectable({ providedIn: 'root' })
export class AgentsService extends ApiClient {
  list(query: AgentListQuery = {}): Observable<PaginatedResponse<Agent>> {
    return this.http.get<PaginatedResponse<Agent>>(this.url('/agents'), {
      params: toHttpParams({ ...query }),
    });
  }

  get(agentId: string): Observable<Agent> {
    return this.http.get<Agent>(this.url(`/agents/${agentId}`));
  }

  create(input: CreateAgentInput): Observable<Agent> {
    return this.http.post<Agent>(this.url('/agents'), input);
  }

  /**
   * Partial update. Keys absent from `input` are left untouched; an explicit
   * `null` clears the column.
   */
  update(agentId: string, input: UpdateAgentInput): Observable<Agent> {
    return this.http.patch<Agent>(this.url(`/agents/${agentId}`), input);
  }

  remove(agentId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/agents/${agentId}`));
  }

  /**
   * Replaces the agent's profile picture (`PUT`, so it is idempotent).
   *
   * The server accepts any single multipart field name; `file` is used here.
   * JPEG, PNG, WebP and GIF are permitted — SVG is rejected server-side to
   * keep stored XSS out of the Tauri webview.
   */
  uploadPicture(agentId: string, file: File): Observable<Agent> {
    const body = new FormData();
    body.append('file', file, file.name);

    return this.http.put<Agent>(this.url(`/agents/${agentId}/picture`), body);
  }

  /** Idempotent: removing a picture from an agent that has none still succeeds. */
  removePicture(agentId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/agents/${agentId}/picture`));
  }
}
