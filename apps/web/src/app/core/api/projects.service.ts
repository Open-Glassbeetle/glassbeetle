import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import { toHttpParams } from './http-params';
import type { PaginatedResponse } from './pagination';
import type {
  CreateProjectInput,
  Project,
  ProjectListQuery,
  UpdateProjectInput,
} from './projects.models';

/** `/api/v1/projects` — the folders chats and artifacts are filed under. */
@Injectable({ providedIn: 'root' })
export class ProjectsService extends ApiClient {
  list(query: ProjectListQuery = {}): Observable<PaginatedResponse<Project>> {
    return this.http.get<PaginatedResponse<Project>>(this.url('/projects'), {
      params: toHttpParams({ ...query }),
    });
  }

  get(projectId: string): Observable<Project> {
    return this.http.get<Project>(this.url(`/projects/${projectId}`));
  }

  create(input: CreateProjectInput): Observable<Project> {
    return this.http.post<Project>(this.url('/projects'), input);
  }

  update(projectId: string, input: UpdateProjectInput): Observable<Project> {
    return this.http.patch<Project>(this.url(`/projects/${projectId}`), input);
  }

  /**
   * Deletes the project.
   *
   * Its chats and artifacts are kept and become unfiled: the foreign keys are
   * cleared rather than cascaded, so removing a folder never removes work.
   */
  remove(projectId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/projects/${projectId}`));
  }
}
