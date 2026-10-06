import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import { toHttpParams } from './http-params';
import type { PaginatedResponse } from './pagination';
import type {
  CreateSystemPromptInput,
  SystemPrompt,
  SystemPromptListQuery,
  UpdateSystemPromptInput,
} from './system-prompts.models';

/** `/api/v1/system-prompts` — reusable instruction templates. */
@Injectable({ providedIn: 'root' })
export class SystemPromptsService extends ApiClient {
  list(query: SystemPromptListQuery = {}): Observable<PaginatedResponse<SystemPrompt>> {
    return this.http.get<PaginatedResponse<SystemPrompt>>(this.url('/system-prompts'), {
      params: toHttpParams({ ...query }),
    });
  }

  get(promptId: string): Observable<SystemPrompt> {
    return this.http.get<SystemPrompt>(this.url(`/system-prompts/${promptId}`));
  }

  create(input: CreateSystemPromptInput): Observable<SystemPrompt> {
    return this.http.post<SystemPrompt>(this.url('/system-prompts'), input);
  }

  update(promptId: string, input: UpdateSystemPromptInput): Observable<SystemPrompt> {
    return this.http.patch<SystemPrompt>(this.url(`/system-prompts/${promptId}`), input);
  }

  remove(promptId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/system-prompts/${promptId}`));
  }
}
