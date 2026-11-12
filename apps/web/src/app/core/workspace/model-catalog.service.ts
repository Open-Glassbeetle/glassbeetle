import { Injectable, computed, inject, signal } from '@angular/core';

import type { Agent } from '../api/agents.models';
import { modelLabel, type Model } from '../api/models.models';
import { ModelsService } from '../api/models.service';

/**
 * The registered models, so an agent can be named with what it runs on.
 *
 * An agent carries a `modelId` and nothing else. Which model that is matters
 * in a conversation — it is half of "who am I talking to" — so the catalogue
 * is read once by the shell and looked up from wherever an agent is shown.
 */
@Injectable({ providedIn: 'root' })
export class ModelCatalogService {
  private readonly api = inject(ModelsService);

  private readonly _models = signal<readonly Model[]>([]);

  readonly models = this._models.asReadonly();

  private readonly byId = computed(() => new Map(this._models().map((model) => [model.id, model])));

  refresh(): void {
    this.api.list({ limit: 100 }).subscribe({
      next: (page) => this._models.set(page.items),
      // Without the catalogue an agent is shown without its model's name,
      // which is a missing label rather than an error worth interrupting for.
      error: () => undefined,
    });
  }

  get(modelId: string | null | undefined): Model | null {
    return modelId ? (this.byId().get(modelId) ?? null) : null;
  }

  /** The name of the model an agent runs on, or `null` when it has none. */
  labelFor(agent: Pick<Agent, 'modelId'> | null | undefined): string | null {
    const model = this.get(agent?.modelId);
    return model ? modelLabel(model) : null;
  }
}
