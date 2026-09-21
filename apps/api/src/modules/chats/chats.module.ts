import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';
import { MessagesController } from './messages/messages.controller.js';
import { MessagesService } from './messages/messages.service.js';
import { CompletionsController } from './completions/completions.controller.js';

@Module({
  controllers: [ChatsController, MessagesController, CompletionsController],
  providers: [ChatsService, MessagesService]
})
export class ChatsModule {}
