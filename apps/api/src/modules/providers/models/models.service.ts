import { Injectable } from '@nestjs/common';

/**
 * Will own the `models` table.
 *
 * Not implemented, which is why assigning a model to an agent is disabled in
 * the frontend: `agents.model_id` has a foreign key to this table, so no
 * agent can reference a model until models can be created.
 *
 * The schema distinguishes a model's `source` — `discovered` from a
 * provider's own listing, or `manual` — and makes `(provider_id,
 * model_identifier)` unique, so discovery can run repeatedly without
 * duplicating rows.
 */
@Injectable()
export class ModelsService {}
