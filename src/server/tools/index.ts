import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Import the converter and JSONSchemaDraft7 type
import { convertJSONSchemaDraft7ToZod } from '../../shared/util/draftToZod'; // Adjusted path
import { JSONSchemaDraft7 } from '../../shared/util/types';   // Adjusted path

// Import window management tools (existing)
import { listOpenWindowsHandler, toolDefinition as listOpenWindowsToolDefinition } from "./window_management/listOpenWindows";
import { viewWindowContentHandler, toolDefinition as viewWindowContentToolDefinition } from "./window_management/viewWindowContent";

// Import new Command Execution tools
import {
  executeCommandHandler, executeCommandToolDefinition,
  readOutputHandler, readOutputToolDefinition,
  forceTerminateHandler, forceTerminateToolDefinition,
  listSessionsHandler, listSessionsToolDefinition
} from "./command_execution";

// Import new Filesystem tools
import {
  readFileHandler, readFileToolDefinition,
  readMultipleFilesHandler, readMultipleFilesToolDefinition,
  writeFileHandler, writeFileToolDefinition,
  createDirectoryHandler, createDirectoryToolDefinition,
  listDirectoryHandler, listDirectoryToolDefinition,
  moveFileHandler, moveFileToolDefinition,
  getFileInfoHandler, getFileInfoToolDefinition
} from "./filesystem";

// Import new Process Management tools
import {
  listProcessesHandler, listProcessesToolDefinition,
  killProcessHandler, killProcessToolDefinition
} from "./process_management";

// Import new Search tools
import {
  searchFilesHandler, searchFilesToolDefinition,
  searchCodeHandler, searchCodeToolDefinition
} from "./search";

// Import new Text Editing tools
import {
  editBlockHandler, editBlockToolDefinition
} from "./text_editing";


interface ToolEntry {
  definition: Tool;
  // The handler now expects Zod-parsed arguments.
  // The specific Zod type varies per tool, so `any` or a generic is suitable here.
  handler: (parsedArgs: any) => Promise<CallToolResult>;
}

// Create a map of all tools with their definitions and handlers
export const toolsMap = new Map<string, ToolEntry>([
  // Window Management (Existing) - Assuming their inputSchema is also JSON Schema
  [listOpenWindowsToolDefinition.name, {
    definition: listOpenWindowsToolDefinition,
    handler: listOpenWindowsHandler // Ensure this handler expects parsed args if schema exists
  }],
  [viewWindowContentToolDefinition.name, {
    definition: viewWindowContentToolDefinition,
    handler: viewWindowContentHandler // Ensure this handler expects parsed args if schema exists
  }],

  // Command Execution (New)
  [executeCommandToolDefinition.name, {
    definition: executeCommandToolDefinition,
    handler: executeCommandHandler
  }],
  [readOutputToolDefinition.name, {
    definition: readOutputToolDefinition,
    handler: readOutputHandler
  }],
  [forceTerminateToolDefinition.name, {
    definition: forceTerminateToolDefinition,
    handler: forceTerminateHandler
  }],
  [listSessionsToolDefinition.name, {
    definition: listSessionsToolDefinition,
    handler: listSessionsHandler
  }],

  // Filesystem (New)
  [readFileToolDefinition.name, {
    definition: readFileToolDefinition,
    handler: readFileHandler
  }],
  [readMultipleFilesToolDefinition.name, {
    definition: readMultipleFilesToolDefinition,
    handler: readMultipleFilesHandler
  }],
  [writeFileToolDefinition.name, {
    definition: writeFileToolDefinition,
    handler: writeFileHandler
  }],
  [createDirectoryToolDefinition.name, {
    definition: createDirectoryToolDefinition,
    handler: createDirectoryHandler
  }],
  [listDirectoryToolDefinition.name, {
    definition: listDirectoryToolDefinition,
    handler: listDirectoryHandler
  }],
  [moveFileToolDefinition.name, {
    definition: moveFileToolDefinition,
    handler: moveFileHandler
  }],
  [getFileInfoToolDefinition.name, {
    definition: getFileInfoToolDefinition,
    handler: getFileInfoHandler
  }],

  // Process Management (New)
  [listProcessesToolDefinition.name, {
    definition: listProcessesToolDefinition,
    handler: listProcessesHandler
  }],
  [killProcessToolDefinition.name, {
    definition: killProcessToolDefinition,
    handler: killProcessHandler
  }],

  // Search (New)
  [searchFilesToolDefinition.name, {
    definition: searchFilesToolDefinition,
    handler: searchFilesHandler
  }],
  [searchCodeToolDefinition.name, {
    definition: searchCodeToolDefinition,
    handler: searchCodeHandler
  }],

  // Text Editing (New)
  [editBlockToolDefinition.name, {
    definition: editBlockToolDefinition,
    handler: editBlockHandler
  }],
]);

// Export all tool definitions for the server to list
export const tools: Tool[] = Array.from(toolsMap.values()).map(entry => entry.definition);


/**
 * Finds a tool by name, parses its arguments using the tool's input schema,
 * and then executes the tool's handler with the parsed arguments.
 *
 * @param toolName The name of the tool to execute.
 * @param rawArguments The raw arguments object received from the client.
 * @returns A Promise resolving to the CallToolResult from the tool's handler.
 * @throws Error if the tool is not found or if argument parsing fails.
 */
export async function callToolAndParseArgs(
  toolName: string,
  rawArguments: Record<string, unknown> | undefined
): Promise<CallToolResult> {
  const toolEntry = toolsMap.get(toolName);
  if (!toolEntry) {
    // This specific error format might be good for the client to receive directly
    return {
      content: [{ type: 'text', text: `Error: Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  try {
    // toolEntry.definition.inputSchema is the JSONSchemaDraft7 object
    const jsonSchema = toolEntry.definition.inputSchema as JSONSchemaDraft7;

    // Handle cases where inputSchema might be empty (e.g. for list_sessions)
    let parsedArgs: any = rawArguments || {};
    if (jsonSchema && Object.keys(jsonSchema.properties).length > 0) {
      const zodSchemaForValidation = convertJSONSchemaDraft7ToZod(jsonSchema);
      parsedArgs = zodSchemaForValidation.parse(rawArguments);
    } else if (Object.keys(jsonSchema.properties).length === 0 && (rawArguments && Object.keys(rawArguments).length > 0) ) {
      // Schema defines no properties, but arguments were provided
      return {
        content: [{ type: 'text', text: `Error: Tool ${toolName} expects no arguments, but arguments were provided.` }],
        isError: true,
      };
    }
    // If jsonSchema.properties is empty and no rawArguments, parsedArgs remains {}

    return await toolEntry.handler(parsedArgs);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return {
        content: [{ type: 'text', text: `Invalid arguments for tool ${toolName}: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}` }],
        isError: true,
      };
    }
    // For other errors from the handler itself, re-throw to be caught by the server's main try-catch
    // or return a structured error
    console.error(`Error during execution of tool ${toolName}:`, error);
    return {
      content: [{ type: 'text', text: `Error executing tool ${toolName}: ${error.message}` }],
      isError: true,
    };
  }
}