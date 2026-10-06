import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import { toHttpParams } from './http-params';
import type {
  AgentMemory,
  CreateMemoryInput,
  Memory,
  MemoryListQuery,
  UpdateMemoryInput,
} from './memories.models';
import type { PaginatedResponse } from './pagination';

/**
 * `/api/v1/agents/:agentId/memories` — memories private to one agent.
 *
 * Every call is scoped by `agentId` in the path. Ids are globally unique, so
 * the server also filters by the parent; reading a memory through the wrong
 * agent's URL is a 404, not another agent's row.
 */
@Injectable({ providedIn: 'root' })
export class AgentMemoriesService extends ApiClient {
  list(agentId: string, query: MemoryListQuery = {}): Observable<PaginatedResponse<AgentMemory>> {
    return this.http.get<PaginatedResponse<AgentMemory>>(this.url(`/agents/${agentId}/memories`), {
      params: toHttpParams({ ...query }),
    });
  }

  get(agentId: string, memoryId: string): Observable<AgentMemory> {
    return this.http.get<AgentMemory>(this.url(`/agents/${agentId}/memories/${memoryId}`));
  }

  create(agentId: string, input: CreateMemoryInput): Observable<AgentMemory> {
    return this.http.post<AgentMemory>(this.url(`/agents/${agentId}/memories`), input);
  }

  update(agentId: string, memoryId: string, input: UpdateMemoryInput): Observable<AgentMemory> {
    return this.http.patch<AgentMemory>(this.url(`/agents/${agentId}/memories/${memoryId}`), input);
  }

  remove(agentId: string, memoryId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/agents/${agentId}/memories/${memoryId}`));
  }
}

/** `/api/v1/memories` — memories every agent can draw on. */
@Injectable({ providedIn: 'root' })
export class SharedMemoriesService extends ApiClient {
  list(query: MemoryListQuery = {}): Observable<PaginatedResponse<Memory>> {
    return this.http.get<PaginatedResponse<Memory>>(this.url('/memories'), {
      params: toHttpParams({ ...query }),
    });
  }

  get(memoryId: string): Observable<Memory> {
    return this.http.get<Memory>(this.url(`/memories/${memoryId}`));
  }

  create(input: CreateMemoryInput): Observable<Memory> {
    return this.http.post<Memory>(this.url('/memories'), input);
  }

  update(memoryId: string, input: UpdateMemoryInput): Observable<Memory> {
    return this.http.patch<Memory>(this.url(`/memories/${memoryId}`), input);
  }

  remove(memoryId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/memories/${memoryId}`));
  }
}
