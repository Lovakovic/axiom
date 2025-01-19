import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

export const toolDefinition: Tool = {
  name: "execute-container",
  description: "Executes commands inside the pcap-analyzer Docker container",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to execute inside the container",
      },
    },
    required: ["command"],
  },
};

export async function executeContainerTool(command: string): Promise<CallToolResult> {
  try {
    const dockerCommand = `docker exec pcap-analyzer ${command}`;
    console.log('Executing container command', dockerCommand);
    const { stdout, stderr } = await execPromise(dockerCommand);
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
          text: `Error executing container command: ${error instanceof Error ? error.message : error}`,
        },
      ],
      isError: true
    };
  }
}
