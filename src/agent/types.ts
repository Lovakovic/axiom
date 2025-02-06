import {AIMessageChunk} from "@langchain/core/messages";

/**
 * Type guard for OpenAIModelStreamEvent.
 * Checks that metadata.ls_provider is "openai"
 * and that data.chunk.kwargs.content is a string.
 */
export function isOpenAIModelStreamEvent(
  event: any
): event is OpenAIModelStreamEvent {
  return (
    event != null &&
    typeof event === "object" &&
    typeof event.event === "string" &&
    typeof event.run_id === "string" &&
    typeof event.name === "string" &&
    event.metadata != null &&
    typeof event.metadata.ls_provider === "string" &&
    event.metadata.ls_provider.toLowerCase() === "openai" &&
    event.data != null &&
    event.data.chunk != null &&
    event.data.chunk.kwargs != null &&
    typeof event.data.chunk.kwargs.content === "string"
  );
}

/**
 * Type guard for AnthropicModelStreamEvent.
 * Checks that metadata.ls_provider is "anthropic"
 * and that data.chunk.kwargs.content is an array.
 */
export function isAnthropicModelStreamEvent(
  event: any
): event is AnthropicModelStreamEvent {
  return (
    event != null &&
    typeof event === "object" &&
    typeof event.event === "string" &&
    typeof event.run_id === "string" &&
    typeof event.name === "string" &&
    event.metadata != null &&
    typeof event.metadata.ls_provider === "string" &&
    event.metadata.ls_provider.toLowerCase() === "anthropic" &&
    event.data != null &&
    event.data.chunk != null &&
    event.data.chunk.kwargs != null &&
    Array.isArray(event.data.chunk.kwargs.content)
  );
}


// ─── OpenAI Interfaces ──────────────────────────────────────────────

export interface OpenAIModelStreamEvent {
  event: string; // e.g. "on_chat_model_stream"
  data: OpenAIData;
  run_id: string;
  name: string; // e.g. "ChatOpenAI"
  tags: any[];
  metadata: unknown
}

export interface OpenAIData {
  chunk: AIMessageChunk;
}


// ─── Anthropic Interfaces ────────────────────────────────────────────

export interface AnthropicModelStreamEvent {
  event: string; // e.g. "on_chat_model_stream"
  data: AnthropicData;
  run_id: string;
  name: string; // e.g. "ChatAnthropic"
  tags: any[];
  metadata: unknown;
}

export interface AnthropicData {
  chunk: AIMessageChunk & { content: AnthropicContent };
}

/**
 * The content array in Anthropic events can contain several types
 */
export type AnthropicContent =
  | string
  | AnthropicTextContent[]
  | AnthropicTextDeltaContent[]
  | AnthropicInputJsonDeltaContent[]
  | AnthropicToolUseContent[];

export interface AnthropicContentBase {
  index: number;
  type: string;
}

export interface AnthropicTextContent extends AnthropicContentBase {
  type: 'text';
  text: string;
}

export interface AnthropicTextDeltaContent extends AnthropicContentBase {
  type: 'text_delta';
  text: string;
}

export interface AnthropicInputJsonDeltaContent extends AnthropicContentBase {
  type: 'input_json_delta';
  input: string;
}

export interface AnthropicToolUseContent extends AnthropicContentBase {
  type: 'tool_use';
  id: string;
  name: string;
  input: string;
}
