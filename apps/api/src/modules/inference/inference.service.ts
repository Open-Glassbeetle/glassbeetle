import { Injectable } from '@nestjs/common';

/**
 * Will run completions against a provider's model.
 *
 * Not implemented, and the reason nothing in the API produces an assistant
 * message: `messages` rows can be created and read, but only by a client
 * writing them itself. The intended responsibility is to assemble a prompt
 * from the chat's history, the agent's instructions and its system prompt,
 * call the model through `AdapterFactoryService`, stream the result back, and
 * record the message and its `usage_events` row.
 *
 * @see `docs/realtime-transport.md` for the agreed streaming transport (SSE).
 */
@Injectable()
export class InferenceService {}
