import { Injectable } from '@nestjs/common';

/**
 * Will select the adapter for a provider kind.
 *
 * Not implemented. The intended responsibility is to map a `providers.kind`
 * value — `anthropic`, `openai`, `google`, `ollama`, `lmstudio` or
 * `openai_compatible` — onto the client that speaks that API, so
 * `InferenceService` can issue a completion without knowing which provider
 * backs the chosen model.
 */
@Injectable()
export class AdapterFactoryService {}
