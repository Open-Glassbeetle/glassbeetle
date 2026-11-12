import type { Chat } from './chats.models';

/** Token usage as a provider reports it, normalised by the API. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number;
}

/**
 * One event of a streamed completion (`POST /chats/:chatId/completions` with
 * `stream: true`), as `docs/realtime-transport.md` defines them.
 *
 * A single-agent chat produces one `message_start` … `message_complete` pair.
 * A team chat produces one pair per member turn, in order, on the same
 * stream — which is what lets the transcript show who is speaking now.
 */
export type CompletionEvent =
  | {
      readonly type: 'message_start';
      readonly data: {
        readonly messageId: string;
        readonly chatId: string;
        readonly sequence: number;
        readonly agentId: string | null;
        readonly agentName?: string | null;
      };
    }
  | { readonly type: 'token'; readonly data: { readonly messageId: string; readonly text: string } }
  | {
      readonly type: 'thought';
      readonly data: { readonly messageId: string; readonly thought: string };
    }
  | { readonly type: 'usage'; readonly data: TokenUsage }
  | {
      readonly type: 'message_complete';
      readonly data: {
        readonly messageId: string;
        readonly tokenCount: number | null;
        readonly usage?: TokenUsage | null;
      };
    }
  | {
      readonly type: 'error';
      readonly data: {
        readonly code: string;
        readonly message: string;
        readonly retryable?: boolean;
      };
    }
  | { readonly type: 'done'; readonly data: string };

/** The layers of the system prompt `GET /chats/:chatId/context` reports. */
export interface ContextSystemDetails {
  readonly promptTemplate: string | null;
  readonly personality: string | null;
  readonly instructions: string | null;
  readonly memorySeam: string | null;
  readonly contextSummary: string | null;
}

/**
 * What would be sent to the model for this chat right now
 * (`GET /chats/:chatId/context`), without sending it.
 *
 * Only the parts the UI shows are typed. The token figures are the API's own
 * estimate — `heuristic` names how it was made — so they are presented as an
 * estimate and never as a count.
 */
export interface ChatContext {
  readonly systemDetails: ContextSystemDetails;
  readonly messageDetails: readonly { readonly sequence: number }[];
  readonly excludedMessages: readonly {
    readonly sequence: number;
    readonly reason: string;
  }[];
  readonly tokenEstimate: {
    readonly systemTokens: number;
    readonly messagesTokens: number;
    readonly totalTokens: number;
    readonly contextWindow: number | null;
    readonly fitsContextWindow: boolean;
    readonly heuristic: string;
  };
}

/** The chat as `POST /chats/:chatId/compact` returns it. */
export interface CompactedChat extends Chat {
  readonly compactedMessagesCount: number;
  readonly compactedBeforeSequence: number | null;
}

/**
 * Splits a buffer of Server-Sent Events into the complete events it holds and
 * whatever is left over.
 *
 * A network chunk ends wherever the socket felt like it, so an event can
 * arrive in halves; only blocks terminated by a blank line are parsed and the
 * tail is handed back to be prepended to the next chunk.
 */
export function parseSseBuffer(buffer: string): {
  readonly events: CompletionEvent[];
  readonly rest: string;
} {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const events: CompletionEvent[] = [];

  for (const block of blocks) {
    let type = '';
    const data: string[] = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        type = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).trimStart());
      }
    }

    if (!type) {
      continue;
    }

    const raw = data.join('\n');
    let parsed: unknown = raw;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // The `[DONE]` sentinel is not JSON, and is not meant to be.
    }

    events.push({ type, data: parsed } as CompletionEvent);
  }

  return { events, rest };
}
