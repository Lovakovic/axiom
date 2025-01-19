import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export const toolDefinition: Tool = {
  name: "execute-shell-persistent",
  description: "Executes bash commands in a persistent shell session on user's laptop",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
    },
    required: ["command"],
  },
};

export async function executeShellPersistentTool(command: string): Promise<CallToolResult> {
  // Placeholder for implementation
  return {
    content: [
      {
        type: "text",
        text: "Not implemented yet",
      },
    ],
    isError: true
  };
}
