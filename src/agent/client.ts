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
  private transport: StdioClientTransport | null = null;

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
    this.transport = new StdioClientTransport({ command, args });
    await this.client.connect(this.transport);
  }

  async disconnect() {
    if (this.transport) {
      try {
        await this.client.close();
      } catch (error) {
        console.error('Error closing client:', error);
      }
      this.transport = null;
    }
  }

  async getTools(): Promise<Tool[]> {
    const response = await this.client.listTools();
    return response.tools;
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = await this.client.callTool({
      name,
      arguments: args
    }, undefined, {
      timeout: 300000 // 5 min
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
