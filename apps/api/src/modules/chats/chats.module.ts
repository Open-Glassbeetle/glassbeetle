import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { MessagesController } from './messages/messages.controller';
import { MessagesService } from './messages/messages.service';
import { CompletionsController } from './completions/completions.controller';

@Module({
  controllers: [ChatsController, MessagesController, CompletionsController],
  providers: [ChatsService, MessagesService]
})
export class ChatsModule {}
