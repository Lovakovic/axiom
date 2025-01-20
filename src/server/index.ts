import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  ServerCapabilities
} from "@modelcontextprotocol/sdk/types.js";
import { tools, toolsMap } from "./tools";
import { promptHandlers, SYSTEM_PROMPTS } from "./prompts";
import { PromptHandlers } from "./prompts/types";

const capabilities: ServerCapabilities = {
  tools: {},
  prompts: {
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
    console.error(`Prompt not found: ${name}`);
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
