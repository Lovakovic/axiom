import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema, CallToolResult, // Keep CallToolResult if needed for casting
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ServerCapabilities
} from "@modelcontextprotocol/sdk/types.js";
import { tools, callToolAndParseArgs } from "./tools"; // Import the new function
import { promptHandlers, SYSTEM_PROMPTS } from "./prompts";
import { PromptHandlers } from "./prompts/types.js";
import { ResourceManager } from "./resources";


export function createServer() {
  const capabilities: ServerCapabilities = {
    tools: {},
    prompts: {
      listChanged: false
    },
    resources: {
      listChanged: false
    }
  };

  const server = new Server(
    {
      name: "shell-server",
      version: "1.0.0",
    },
    {
      capabilities
    }
  );

  const resourceManager = new ResourceManager();

  // Resource handlers
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = await resourceManager.listAllResources();
    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = await resourceManager.readResource(request.params.uri);
    return {
      contents: [resource]
    };
  });

  // Tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools }; // Still use the exported tools array
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Delegate to the new function in tools/index.ts
    try {
      return await callToolAndParseArgs(request.params.name, request.params.arguments);
    } catch (error: any) {
      // This catch is for unexpected errors not handled by callToolAndParseArgs's try-catch
      // (e.g., if callToolAndParseArgs itself throws before its own try-catch)
      // or if it re-throws.
      console.error(`Unhandled error in CallToolRequest for ${request.params.name}:`, error);
      return {
        content: [{ type: 'text', text: `An unexpected server error occurred while calling tool ${request.params.name}: ${error.message}` }],
        isError: true,
      } as CallToolResult; // Ensure it conforms to CallToolResult
    }
  });

  // Prompt handlers
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: Object.values(SYSTEM_PROMPTS) };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const name = request.params.name as keyof PromptHandlers;
    const promptHandler = promptHandlers[name];
    if (!promptHandler) {
      throw new Error(`Prompt not found: ${name}`);
    }
    return promptHandler(request.params.arguments || {});
  });

  const cleanup = async () => {
    // Add any cleanup logic here
  };

  return { server, cleanup };
}

// Only start the stdio server if this file is being run directly
if (require.main === module) {
  const startStdioServer = async () => {
    const transport = new StdioServerTransport();
    const { server, cleanup } = createServer();

    await server.connect(transport);

    process.on("SIGINT", async () => {
      await cleanup();
      await server.close();
      process.exit(0);
    });
  };

  startStdioServer().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}