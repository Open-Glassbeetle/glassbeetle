import { Controller } from '@nestjs/common';

/**
 * Will expose `/providers/:providerId/models`.
 *
 * No routes yet. Nested because this is one provider's catalogue: the models
 * it offers, and the discovery that refreshes them. Being scoped, its
 * queries will have to filter on `provider_id` as well as on the model's own
 * id — see `docs/api-conventions.md`.
 */
@Controller('providers/:providerId/models')
export class ProviderModelsController {}
