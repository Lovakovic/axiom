import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { toolDefinition as executeShellTool, executeShellTool as executeShell } from "./shell/execute-shell";
import { toolDefinition as executeShellPersistentTool, executeShellPersistentTool as executeShellPersistent } from "./shell/execute-shell-persistent.js";
import { toolDefinition as executeContainerTool, executeContainerTool as executeContainer } from "./shell/execute-container";

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
  ["execute-shell-persistent", {
    definition: executeShellPersistentTool,
    handler: executeShellPersistent
  }],
  ["execute-container", {
    definition: executeContainerTool,
    handler: executeContainer
  }]
]);

// Export all tool definitions
export const tools: Tool[] = Array.from(toolsMap.values()).map(entry => entry.definition);

// Export all tool implementations for backward compatibility
export {
  executeShell,
  executeShellPersistent,
  executeContainer,
};
