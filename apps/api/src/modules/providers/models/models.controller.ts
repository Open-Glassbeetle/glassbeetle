import { Controller } from '@nestjs/common';

/**
 * Will expose `/models`: the flat list of models across all providers.
 *
 * No routes yet. The counterpart to {@link ProviderModelsController}, which
 * will serve one provider's models; this one is what an agent's model picker
 * needs, since `agents.model_id` references a model regardless of who
 * provides it.
 */
@Controller('models')
export class ModelsController {}
