export interface ToolUseEvent {
  name: string;
  id: string;
}

// Gets emitted at the beginning of a tool invocation
export type ToolStartEvent = {
  type: 'tool_start';
  tool: ToolUseEvent;
}

// Stream of the LLM input to a tool
export type  ToolInputEvent = {
  type: 'tool_input_delta';
  content: string;
  toolId: string;
}

// Tool invocation event - at the end of tool input stream
export type ToolEvent = {
  type: 'tool_call';
  tool: {
    name: string;
    id: string;
    args: Record<string, unknown>;
  };
}

// The full text of a message
export type MessageEvent = {
  type: 'text';
  content: string;
}

// Stream of text chunks
export type TextStreamEvent = {
  type: 'text_delta';
  content: string;
}

export type StreamEvent = MessageEvent | TextStreamEvent | ToolStartEvent | ToolInputEvent | ToolEvent;
