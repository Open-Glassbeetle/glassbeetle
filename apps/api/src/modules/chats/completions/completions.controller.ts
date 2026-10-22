import { Controller } from '@nestjs/common';

/**
 * Will expose the completion endpoints for one chat.
 *
 * Declared with the `chats/:chatId` path but no routes, so it contributes
 * nothing to the API yet; completions wait on `InferenceService`. Kept in
 * place so the route prefix and the module registration are already settled.
 *
 * @see `docs/realtime-transport.md` for the agreed streaming transport (SSE).
 */
@Controller('chats/:chatId')
export class CompletionsController {}
