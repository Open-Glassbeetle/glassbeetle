import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import { toHttpParams } from './http-params';
import type { Model, ModelListQuery } from './models.models';
import type { PaginatedResponse } from './pagination';

/** `/api/v1/models` — the models registered across every provider. */
@Injectable({ providedIn: 'root' })
export class ModelsService extends ApiClient {
  list(query: ModelListQuery = {}): Observable<PaginatedResponse<Model>> {
    return this.http.get<PaginatedResponse<Model>>(this.url('/models'), {
      params: toHttpParams({ ...query }),
    });
  }
}
