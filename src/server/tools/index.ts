import { executeShellTool as executeShell, toolDefinition as executeShellTool } from "./shell/execute-shell";
import {
  executeShellPersistentTool as executeShellPersistent,
  toolDefinition as executeShellPersistentTool
} from "./shell/execute-shell-persistent.js";
import {
  executeContainerTool as executeContainer,
  toolDefinition as executeContainerTool
} from "./shell/execute-container";
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
