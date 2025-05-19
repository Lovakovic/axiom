import { executeShellTool as executeShell, toolDefinition as executeShellToolDefinition } from "./shell/executeShell";
import { concatenateFiles as concatenateFilesHandler, toolDefinition as concatenateFilesToolDefinition } from "./concatenate_files/concatenateFiles";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

interface ToolEntry {
  definition: Tool;
  handler: Function;
}

// Create a map of all tools with their definitions and handlers
export const toolsMap = new Map<string, ToolEntry>([
  ["execute-shell", {
    definition: executeShellToolDefinition,
    handler: executeShell
  }],
  ["concatenate_files", {
    definition: concatenateFilesToolDefinition,
    handler: concatenateFilesHandler
  }],
]);

// Export all tool definitions
export const tools: Tool[] = Array.from(toolsMap.values()).map(entry => entry.definition);
