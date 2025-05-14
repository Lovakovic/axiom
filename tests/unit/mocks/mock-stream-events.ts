import { StreamEvent } from "../../../src/agent/types";

// Simple text response
export const simpleMockResponse: StreamEvent[] = [
  { type: 'text_delta', content: 'Hello, ' },
  { type: 'text_delta', content: 'I am ' },
  { type: 'text_delta', content: 'the assistant.' },
  { type: 'text', content: 'Hello, I am the assistant.' }
];

// Response with tool call
export const toolCallMockResponse: StreamEvent[] = [
  { type: 'text_delta', content: 'Let me ' },
  { type: 'text_delta', content: 'help you ' },
  { type: 'text_delta', content: 'with that.' },
  {
    type: 'tool_start',
    tool: {
      name: 'execute-shell',
      id: 'mock-tool-id-123'
    }
  },
  {
    type: 'tool_input_delta',
    content: 'ls -la',
    toolId: 'mock-tool-id-123'
  },
  {
    type: 'tool_call',
    tool: {
      name: 'execute-shell',
      id: 'mock-tool-id-123',
      args: { command: 'ls -la' }
    }
  },
  { type: 'text_delta', content: 'Here ' },
  { type: 'text_delta', content: 'are your ' },
  { type: 'text_delta', content: 'files.' },
  { type: 'text', content: 'Let me help you with that. Here are your files.' }
];
