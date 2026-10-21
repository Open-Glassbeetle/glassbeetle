import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import { toHttpParams } from './http-params';
import type { CreateMessageInput, Message, MessageListQuery } from './messages.models';
import type { PaginatedResponse } from './pagination';

/** `/api/v1/chats/:chatId/messages` — the turns of one conversation. */
@Injectable({ providedIn: 'root' })
export class MessagesService extends ApiClient {
  /**
   * One page of a conversation.
   *
   * The envelope's `total` is the whole chat, not the page, which is what lets
   * the transcript say whether there is more above without asking again.
   */
  list(chatId: string, query: MessageListQuery = {}): Observable<PaginatedResponse<Message>> {
    return this.http.get<PaginatedResponse<Message>>(this.url(`/chats/${chatId}/messages`), {
      params: toHttpParams({ ...query }),
    });
  }

  /**
   * Appends a turn.
   *
   * Nothing answers it: the completion endpoints do not exist yet, so this
   * stores what was said and advances the chat's `updatedAt`, and that is all.
   */
  create(chatId: string, input: CreateMessageInput): Observable<Message> {
    return this.http.post<Message>(this.url(`/chats/${chatId}/messages`), input);
  }
}
