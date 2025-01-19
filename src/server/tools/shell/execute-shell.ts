import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

export const toolDefinition: Tool = {
  name: "execute-shell",
  description: "Executes bash commands on user's laptop and returns the output. This allows you to ",
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

export async function executeShellTool(command: string): Promise<CallToolResult> {
  try {
    console.log('Executing command', command)
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
