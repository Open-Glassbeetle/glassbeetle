/**
 * Role representation in the Google Gemini wire API.
 * Gemini uses 'user' for user inputs and 'model' for assistant responses.
 */
export type GeminiWireRole = 'user' | 'model';

/**
 * A single part of a Gemini message content block.
 *
 * ## Multimodal Extension Slot:
 * Currently, Glassbeetle's `messages.content` is a single TEXT column storing strings.
 * When the database schema and normalised interface expand to support multimodal content,
 * binary and media payloads slot directly into this structure:
 *
 * ```ts
 * export type GeminiPart =
 *   | GeminiTextPart
 *   | { inlineData: { mimeType: string; data: string } } // Base64 encoded blob
 *   | { fileData: { mimeType: string; fileUri: string } }; // Google File API URI
 * ```
 */
export interface GeminiTextPart {
  text: string;
  thought?: boolean;
}

export type GeminiPart = GeminiTextPart;

/**
 * Content turn in the Gemini API request/response.
 */
export interface GeminiContent {
  role: GeminiWireRole;
  parts: GeminiPart[];
}

/**
 * Top-level system instruction passed to Gemini models.
 */
export interface GeminiSystemInstruction {
  role?: 'system' | 'user';
  parts: GeminiPart[];
}

/**
 * Nested generation configuration parameters.
 */
export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  candidateCount?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  responseMimeType?: string;
  [key: string]: unknown;
}

/**
 * Wire request body for Gemini's `generateContent` and `streamGenerateContent` endpoints.
 */
export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiSystemInstruction;
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: unknown;
  [key: string]: unknown;
}

/**
 * Safety rating block reported by Gemini.
 */
export interface GeminiSafetyRating {
  category: string;
  probability: string;
  blocked?: boolean;
}

/**
 * Candidate generation choice in Gemini response.
 */
export interface GeminiCandidate {
  content?: {
    role?: string;
    parts?: Array<{ text?: string; thought?: boolean }>;
  };
  finishReason?: string;
  safetyRatings?: GeminiSafetyRating[];
  index?: number;
}

/**
 * Prompt-level feedback block, e.g. when an input prompt is blocked by safety filters.
 */
export interface GeminiPromptFeedback {
  blockReason?: string;
  safetyRatings?: GeminiSafetyRating[];
}

/**
 * Token usage metadata returned by Gemini.
 */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

/**
 * Wire response body from Gemini's `generateContent` endpoint.
 */
export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: GeminiPromptFeedback;
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

/**
 * Upstream error payload format returned by Google APIs.
 */
export interface GeminiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: unknown[];
  };
}

/**
 * A model entry returned by Gemini's `GET /v1beta/models` endpoint.
 */
export interface GeminiModelItem {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  temperature?: number;
  topP?: number;
  topK?: number;
}

/**
 * Wire response body from Gemini's `GET /v1beta/models` endpoint.
 */
export interface GeminiListModelsResponse {
  models?: GeminiModelItem[];
  nextPageToken?: string;
}
