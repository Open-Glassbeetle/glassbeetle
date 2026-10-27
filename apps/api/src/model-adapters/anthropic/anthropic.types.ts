/**
 * Internal wire types for Anthropic Messages and Models API (`v1/messages`, `v1/models`).
 *
 * References:
 * - https://docs.anthropic.com/en/api/messages
 * - https://docs.anthropic.com/en/api/models
 */

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | { type: string; [key: string]: unknown };

export interface AnthropicWireMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicWireMessage[];
  max_tokens: number;
  system?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  [key: string]: unknown;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason:
    | 'end_turn'
    | 'max_tokens'
    | 'stop_sequence'
    | 'tool_use'
    | string
    | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export interface AnthropicErrorBody {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export interface AnthropicSseMessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    model: string;
    usage?: AnthropicUsage;
  };
}

export interface AnthropicSseContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: string; [key: string]: unknown };
}

export interface AnthropicSseMessageDeltaEvent {
  type: 'message_delta';
  delta?: {
    stop_reason?: string | null;
    stop_sequence?: string | null;
  };
  usage?: {
    output_tokens?: number;
  };
}

export interface AnthropicModelItem {
  type: 'model';
  id: string;
  display_name: string;
  created_at: string;
  context_window?: number;
  max_tokens?: number;
  default_max_tokens?: number;
  default_temperature?: number;
}

export interface AnthropicModelsResponse {
  data: AnthropicModelItem[];
  has_more?: boolean;
  first_id?: string | null;
  last_id?: string | null;
}
