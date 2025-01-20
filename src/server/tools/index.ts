import { executeShellTool as executeShell, toolDefinition as executeShellTool } from "./shell/execute-shell";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

interface ToolEntry {
  definition: Tool;
  handler: Function;
}

// Create a map of all tools with their definitions and handlers
export const toolsMap = new Map<string, ToolEntry>([
  ["execute-shell", {
    definition: executeShellTool,
    handler: executeShell
  }],
]);

// Export all tool definitions
export const tools: Tool[] = Array.from(toolsMap.values()).map(entry => entry.definition);