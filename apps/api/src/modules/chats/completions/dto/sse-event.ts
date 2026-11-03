import type { StreamErrorPayload } from '../../../../model-adapters/types/streaming.js';

/**
 * Payload emitted when a message sequence starts.
 */
export interface MessageStartPayload {
  readonly messageId: string;
  readonly chatId: string;
  readonly sequence: number;
  readonly agentId: string | null;
  readonly agentName?: string | null;
  readonly role: 'assistant';
}

/**
 * Payload emitted for an incremental text token delta.
 */
export interface TokenPayload {
  readonly messageId: string;
  readonly text: string;
}

/**
 * Payload emitted for an incremental reasoning / thought delta.
 */
export interface ThoughtPayload {
  readonly messageId: string;
  readonly thought: string;
}

/**
 * Normalised token usage metrics emitted as a terminal or mid-stream event.
 */
export interface UsagePayload {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number;
}

/**
 * Payload emitted when message generation completes successfully.
 */
export interface MessageCompletePayload {
  readonly messageId: string;
  readonly status: 'complete';
  readonly tokenCount: number | null;
  readonly usage?: UsagePayload | null;
}

/**
 * Discriminated union of Server-Sent Events emitted by chat completions streaming.
 *
 * Aligns strictly with the realtime transport specification (`docs/realtime-transport.md`).
 */
export type SseCompletionEvent =
  | {
      readonly type: 'message_start';
      readonly data: MessageStartPayload;
    }
  | {
      readonly type: 'token';
      readonly data: TokenPayload;
    }
  | {
      readonly type: 'thought';
      readonly data: ThoughtPayload;
    }
  | {
      readonly type: 'usage';
      readonly data: UsagePayload;
    }
  | {
      readonly type: 'message_complete';
      readonly data: MessageCompletePayload;
    }
  | {
      readonly type: 'error';
      readonly data: StreamErrorPayload;
    }
  | {
      readonly type: 'done';
      readonly data: '[DONE]';
    };

/**
 * Formats a typed SSE completion event into standard SSE wire representation.
 *
 * Example:
 * ```
 * event: token
 * data: {"messageId":"...","text":"Hello"}
 *
 * ```
 */
export function formatSseEvent(event: SseCompletionEvent): string {
  const dataString =
    typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
  return `event: ${event.type}\ndata: ${dataString}\n\n`;
}

/**
 * Helper to parse a raw Server-Sent Events stream chunk or buffer into structured event objects.
 * Useful for test suites and client assertion.
 */
export function parseSseEvents(
  rawText: string,
): Array<{ type: string; data: any }> {
  const events: Array<{ type: string; data: any }> = [];
  const blocks = rawText.split(/\r?\n\r?\n/).filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    let type = 'message';
    let dataStr = '';

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event: ')) {
        type = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataStr = line.slice(6).trim();
      }
    }

    let parsedData: any = dataStr;
    try {
      parsedData = JSON.parse(dataStr);
    } catch {
      // String sentinel like [DONE]
    }

    events.push({ type, data: parsedData });
  }

  return events;
}
