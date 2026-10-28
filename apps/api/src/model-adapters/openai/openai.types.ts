/**
 * Allowed roles for OpenAI Chat Completions wire protocol.
 */
export type OpenAiWireRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Message representation on the OpenAI Chat Completions wire protocol.
 */
export interface OpenAiWireMessage {
  role: OpenAiWireRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

/**
 * Outbound JSON payload for `POST /chat/completions`.
 */
export interface OpenAiChatCompletionRequest {
  model: string;
  messages: OpenAiWireMessage[];
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

/**
 * Token usage report structure in OpenAI responses.
 */
export interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    reasoning_tokens?: number;
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

/**
 * Single choice in a non-streaming Chat Completions response.
 */
export interface OpenAiChoice {
  index?: number;
  message?: {
    role?: string;
    content?: string | null;
    reasoning_content?: string | null;
  };
  finish_reason?: string | null;
}

/**
 * Inbound response from non-streaming `POST /chat/completions`.
 */
export interface OpenAiChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: OpenAiChoice[];
  usage?: OpenAiUsage;
  [key: string]: unknown;
}

/**
 * Incremental chunk delta in a streaming Chat Completions response.
 */
export interface OpenAiStreamDelta {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
}

/**
 * Single choice in a streaming Chat Completions chunk.
 */
export interface OpenAiStreamChoice {
  index?: number;
  delta?: OpenAiStreamDelta;
  finish_reason?: string | null;
}

/**
 * Inbound SSE chunk data object from streaming `POST /chat/completions`.
 */
export interface OpenAiChatCompletionChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: OpenAiStreamChoice[];
  usage?: OpenAiUsage;
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
  [key: string]: unknown;
}

/**
 * Single model item returned by `GET /models`.
 */
export interface OpenAiModelItem {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  name?: string;
  display_name?: string;
  context_window?: number;
  context_length?: number;
  max_context_length?: number;
  default_temperature?: number;
  default_max_tokens?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

/**
 * Inbound response from `GET /models`.
 */
export interface OpenAiModelsResponse {
  object?: string;
  data?: OpenAiModelItem[];
  [key: string]: unknown;
}

/**
 * Standard OpenAI error response envelope.
 */
export interface OpenAiErrorBody {
  error?: {
    message?: string;
    type?: string;
    param?: string | null;
    code?: string | number | null;
  };
  message?: string;
}
