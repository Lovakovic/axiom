import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResult, GetPromptResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export class MCPClient {
  private readonly client: Client;

  constructor() {
    this.client = new Client(
      {
        name: "computer-use-agent",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
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

  async getPrompt(name: string, arguments_?: Record<string, unknown>): Promise<GetPromptResult> {
    // Convert all argument values to strings for MCP protocol compliance
    const stringArgs = arguments_ ?
      Object.fromEntries(
        Object.entries(arguments_).map(([key, value]) => [key, String(value)])
      ) :
      undefined;

    return await this.client.getPrompt({
      name,
      arguments: stringArgs
    });
  }
}