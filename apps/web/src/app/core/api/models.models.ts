import type { PageQuery } from './pagination';

/**
 * A model an agent can run on (`GET /api/v1/models`).
 *
 * The provider is embedded, so naming what an agent runs on — "which model,
 * from where" — is one read rather than two.
 */
export interface Model {
  readonly id: string;
  readonly providerId: string;
  readonly modelIdentifier: string;
  readonly displayName: string | null;
  readonly contextWindow: number | null;
  readonly enabled: boolean;
  readonly provider?: {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
  } | null;
}

export interface ModelListQuery extends PageQuery {
  readonly providerId?: string;
  readonly enabled?: boolean;
}

/** What to call a model: its display name, or the identifier it is run by. */
export function modelLabel(model: Model): string {
  return model.displayName?.trim() || model.modelIdentifier;
}
