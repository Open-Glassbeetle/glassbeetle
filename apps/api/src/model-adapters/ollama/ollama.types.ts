/**
 * Allowed roles for Ollama chat messages.
 */
export type OllamaMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Message object structure in the Ollama `/api/chat` wire API.
 */
export interface OllamaWireMessage {
  role: OllamaMessageRole;
  content: string;
  images?: string[];
}

/**
 * Generation options passed to Ollama models via `options`.
 */
export interface OllamaOptions {
  temperature?: number;
  num_predict?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
  seed?: number;
  num_ctx?: number;
  [key: string]: unknown;
}

/**
 * Request payload for Ollama's `POST /api/chat` endpoint.
 */
export interface OllamaChatRequest {
  model: string;
  messages: OllamaWireMessage[];
  stream?: boolean;
  format?: string;
  options?: OllamaOptions;
  keep_alive?: string | number;
  [key: string]: unknown;
}

/**
 * Response chunk or complete response from Ollama's `POST /api/chat` endpoint.
 */
export interface OllamaChatResponse {
  model: string;
  created_at?: string;
  message?: {
    role: OllamaMessageRole;
    content: string;
    thinking?: string;
    reasoning_content?: string;
  };
  done_reason?: string;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
}

/**
 * Model details block returned by Ollama's `GET /api/tags` endpoint.
 */
export interface OllamaModelDetails {
  parent_model?: string;
  format?: string;
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
}

/**
 * A model entry returned by Ollama's `GET /api/tags` endpoint.
 */
export interface OllamaModelItem {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: OllamaModelDetails;
  context_window?: number;
}

/**
 * Response payload from Ollama's `GET /api/tags` endpoint.
 */
export interface OllamaTagsResponse {
  models?: OllamaModelItem[];
  error?: string;
}
