import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "hello",
    description: "A simple hello world tool",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name to say hello to",
        },
      },
      required: ["name"],
    },
  },
];

export async function executeHelloTool(name: string): Promise<CallToolResult> {
  return {
    content: [
      {
        type: "text",
        text: `Hello, ${name}!`
      }
    ]
  };
}