import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import type { Artifact, ArtifactListQuery } from './artifacts.models';
import { toHttpParams } from './http-params';
import type { PaginatedResponse } from './pagination';

/** `/api/v1/artifacts` — what agents produced, kept beyond the chat. */
@Injectable({ providedIn: 'root' })
export class ArtifactsService extends ApiClient {
  /** One page of artifacts, without their content. */
  list(query: ArtifactListQuery = {}): Observable<PaginatedResponse<Artifact>> {
    return this.http.get<PaginatedResponse<Artifact>>(this.url('/artifacts'), {
      params: toHttpParams({ ...query }),
    });
  }

  /** One artifact, with its inline text content when it has any. */
  get(artifactId: string): Observable<Artifact> {
    return this.http.get<Artifact>(this.url(`/artifacts/${artifactId}`));
  }

  /** Where a file-backed artifact's bytes are served from. */
  contentUrl(artifactId: string): string {
    return this.url(`/artifacts/${artifactId}/content`);
  }

  remove(artifactId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/artifacts/${artifactId}`));
  }
}
