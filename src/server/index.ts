import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ServerCapabilities
} from "@modelcontextprotocol/sdk/types.js";
import { tools, toolsMap } from "./tools";
import { promptHandlers, SYSTEM_PROMPTS } from "./prompts";
import { PromptHandlers } from "./prompts/types";
import { ResourceManager } from "./resources";

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

// Initialize resource manager
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
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolsMap.get(request.params.name);
  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  return tool.handler(request.params.arguments?.["command"] as string);
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


export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
