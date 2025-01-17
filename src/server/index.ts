import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools, executeHelloTool } from "./tools";

const server = new Server(
  {
    name: "minimal-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "hello":
      return executeHelloTool(request.params.arguments?.['name'] as string);
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
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