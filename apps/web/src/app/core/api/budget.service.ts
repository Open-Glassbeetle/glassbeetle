import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import type { Budget, UpdateBudgetInput } from './budget.models';

/** `/api/v1/budget` — the spending budget and the current period. */
@Injectable({ providedIn: 'root' })
export class BudgetService extends ApiClient {
  /**
   * Reads the budget and the spend against it.
   *
   * Never 404s: the budget is a singleton the API provisions on first read, so
   * a client does not have to handle "no budget yet".
   */
  get(): Observable<Budget> {
    return this.http.get<Budget>(this.url('/budget'));
  }

  /**
   * Partial update. An omitted key leaves the field alone; `limitUsd: null`
   * removes the budget and leaves spending reported but unbounded.
   */
  update(input: UpdateBudgetInput): Observable<Budget> {
    return this.http.patch<Budget>(this.url('/budget'), input);
  }
}
