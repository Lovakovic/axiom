import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export class MCPClient {
  private readonly client: Client;

  constructor() {
    this.client = new Client(
      {
        name: "test-agent",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  async connect(command: string, args: string[] = []) {
    const transport = new StdioClientTransport({ command, args });
    await this.client.connect(transport);
    console.log("Connected to MCP server");
  }

  async getTools(): Promise<Tool[]> {
    const response = await this.client.listTools();
    return response.tools;
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = await this.client.callTool({
      name,
      arguments: args
    });
    return result as CallToolResult;
  }
}