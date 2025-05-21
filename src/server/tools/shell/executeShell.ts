import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

interface ToolParams {
  command: string;
}

export const toolDefinition: Tool = {
  name: "execute-shell",
  description: "Executes bash commands on user's laptop and returns the output. This allows you to run any command.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
    },
    required: ["command"],
  },
};

export async function executeShellTool(args: ToolParams): Promise<CallToolResult> {
  const { command } = args;
  try {
    const { stdout, stderr } = await execPromise(command);
    return {
      content: [
        {
          type: "text",
          text: `Output:\n${stdout}\n${stderr ? `Errors:\n${stderr}` : ""}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing command: ${error instanceof Error ? error.message : error}`,
        },
      ],
      isError: true
    };
  }
}
