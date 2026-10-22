import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';
import { MessagesController } from './messages/messages.controller.js';
import { MessagesService } from './messages/messages.service.js';
import { CompletionsController } from './completions/completions.controller.js';

/**
 * Wires `/chats` together with its two sub-resources.
 *
 * Three controllers share one module because messages and completions are
 * parts of a chat rather than resources of their own: a message has no
 * meaning outside its chat, and `CompletionsController` acts on a chat's
 * history. Exports nothing, since no other feature reads chats.
 */
@Module({
  controllers: [ChatsController, MessagesController, CompletionsController],
  providers: [ChatsService, MessagesService]
})
export class ChatsModule {}
