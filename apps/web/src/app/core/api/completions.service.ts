import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-base';
import {
  parseSseBuffer,
  type ChatContext,
  type CompactedChat,
  type CompletionEvent,
} from './completions.models';

/**
 * `/api/v1/chats/:chatId/{completions,context,compact}` — asking the chat's
 * agent or team for its next turn, and looking at what it would be given.
 */
@Injectable({ providedIn: 'root' })
export class CompletionsService extends ApiClient {
  /**
   * Streams the next turn of a chat.
   *
   * `fetch` rather than `HttpClient`, because the response is a stream to be
   * read as it arrives and `EventSource` cannot POST. Unsubscribing aborts the
   * request, and the API cancels the model call when the connection closes —
   * so stopping a run here stops it at the provider too.
   *
   * A failure before the first byte arrives as an ordinary error envelope with
   * a status, and is raised as the `HttpErrorResponse` every other call would
   * raise, so `toApiError` treats both the same. A failure after the stream
   * has begun arrives as an `error` event instead.
   */
  stream(chatId: string): Observable<CompletionEvent> {
    return new Observable<CompletionEvent>((subscriber) => {
      const abort = new AbortController();
      const url = this.url(`/chats/${chatId}/completions`);

      void (async () => {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({ stream: true }),
            signal: abort.signal,
          });

          if (!response.ok || !response.body) {
            const body: unknown = await response.json().catch(() => null);
            throw new HttpErrorResponse({ status: response.status, error: body, url });
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            const parsed = parseSseBuffer(buffer + decoder.decode(value, { stream: true }));
            buffer = parsed.rest;
            parsed.events.forEach((event) => subscriber.next(event));
          }

          subscriber.complete();
        } catch (error) {
          if (abort.signal.aborted) {
            return;
          }

          subscriber.error(
            error instanceof HttpErrorResponse
              ? error
              : new HttpErrorResponse({ status: 0, error, url }),
          );
        }
      })();

      return () => abort.abort();
    });
  }

  /** What the model would be sent for this chat, without sending it. */
  context(chatId: string): Observable<ChatContext> {
    return this.http.get<ChatContext>(this.url(`/chats/${chatId}/context`));
  }

  /**
   * Summarises the earlier turns into the chat's context summary.
   *
   * The turns themselves stay readable: compaction changes what the model is
   * sent, not what the transcript holds.
   */
  compact(chatId: string): Observable<CompactedChat> {
    return this.http.post<CompactedChat>(this.url(`/chats/${chatId}/compact`), {});
  }
}
