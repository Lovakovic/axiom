export interface ToolUseEvent {
  name: string;
  id: string;
}

export type StreamEvent = {
  type: "text";
  content: string;
} | {
  type: "tool_start";
  tool: ToolUseEvent;
} | {
  type: "tool_input";
  content: string;
  toolId: string;
};
