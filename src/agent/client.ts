import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  BlobResourceContents,
  CallToolResult,
  GetPromptResult,
  Resource,
  TextResourceContents,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { ReadResourceResult } from "@modelcontextprotocol/sdk/types";

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
          resources: {}
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

  async listResources(): Promise<Resource[]> {
    const response = await this.client.listResources();
    return response.resources;
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    return await this.client.readResource({ uri });
  }

  // Helper method to determine if a resource is an image
  isImageResource(resource: Resource): boolean {
    return resource.mimeType?.startsWith('image/') ?? false;
  }

  // Helper method to get base64 data from a resource
  getResourceData(contents: TextResourceContents | BlobResourceContents): string {
    if ('blob' in contents) {
      // For binary (image) content
      return `data:${contents.mimeType};base64,${contents.blob}`;
    } else {
      // For text content
      return contents.text;
    }
  }
}