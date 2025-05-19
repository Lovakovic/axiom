import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

interface ToolParams {
  command: string;
  shell?: string;
}

export const toolDefinition: Tool = {
  name: "execute-shell",
  description: "Executes shell commands or scripts on the user's system and returns the output. Input 'command' can be a multi-line script.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command or multi-line script to execute. Ensure proper shell syntax, including quoting for arguments within the script.",
      },
      shell: {
        type: "string",
        description: "Optional. The shell to use for executing the script (e.g., /bin/bash, /bin/zsh). Defaults to /bin/sh if not specified or if the provided shell seems invalid.",
        optional: true,
      }
    },
    required: ["command"],
  },
};

export async function executeShellTool(args: ToolParams): Promise<CallToolResult> {
  const { command: scriptContent } = args;
  let userShell = args.shell;
  let tempFilePath: string | undefined;

  // Validate or default the shell
  if (!userShell || typeof userShell !== 'string' || userShell.trim() === "" || userShell.includes(" ") || !path.isAbsolute(userShell)) {
    // If a problematic shell was provided but it wasn't empty, one might log a warning here for developers.
    // For a clean version, we just default.
    userShell = "/bin/sh"; // Default shell
  }

  try {
    const tempDir = path.join(os.tmpdir(), "axiom-scripts");
    await fs.mkdir(tempDir, { recursive: true });

    const uniqueSuffix = crypto.randomBytes(6).toString("hex");
    tempFilePath = path.join(tempDir, `script-${uniqueSuffix}.sh`);

    await fs.writeFile(tempFilePath, scriptContent, { encoding: "utf8" });
    await fs.chmod(tempFilePath, 0o700); // rwx------

    // Minimal check for file existence (optional, as spawn would fail anyway)
    // but can give a slightly more specific error before spawn if fs.stat fails.
    try {
      await fs.stat(tempFilePath);
    } catch (statError: any) {
      throw new Error(`Failed to create or access temporary script file ${tempFilePath}: ${statError.message}`);
    }

    const execution = spawn(userShell, [tempFilePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      timeout: 120000, // 2 minutes timeout
    });

    let stdout = "";
    let stderr = "";
    let combinedOutputForError = ""; // To capture all output for error reporting

    execution.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      combinedOutputForError += chunk;
    });

    execution.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      combinedOutputForError += chunk;
    });

    return new Promise<CallToolResult>((resolve, rejectPromise) => {
      execution.on("close", (code) => {
        if (code === 0) {
          resolve({
            content: [
              {
                type: "text",
                text: `Exit Code: ${code}\nOutput:\n${stdout}${stderr ? `\n---Stderr Output---\n${stderr}` : ""}`,
              },
            ],
          });
        } else {
          resolve({
            content: [
              {
                type: "text",
                // Provide comprehensive info to the LLM on failure
                text: `Script execution failed.\nExit Code: ${code}\nShell: ${userShell}\nScript Path: ${tempFilePath}\n--- Combined Stderr/Stdout Log ---\n${combinedOutputForError.trim()}\n--- End of Log ---`,
              },
            ],
            isError: true,
          });
        }
      });

      execution.on("error", (err) => {
        // This error means spawn itself failed (e.g., shell executable not found)
        console.error(`[executeShellTool] Failed to start subprocess for ${tempFilePath} with shell ${userShell}: ${err.message}`, err);
        // Reject the promise, which will be caught by the outer try/catch
        rejectPromise(new Error(`Failed to start script process (shell: ${userShell}): ${err.message}`));
      });
    });

  } catch (error: any) {
    console.error(`[executeShellTool] Error during script preparation or execution (path: ${tempFilePath || 'N/A'}): ${error.message}`, error.stack);
    return {
      content: [
        {
          type: "text",
          text: `Error processing shell command: ${error.message}. Temp script path (if generated): ${tempFilePath || "not generated"}.`,
        },
      ],
      isError: true,
    };
  } finally {
    if (tempFilePath) {
      fs.unlink(tempFilePath)
        .catch(cleanupError => console.warn(`[executeShellTool] Failed to delete temporary script file ${tempFilePath}: ${cleanupError.message}`));
    }
  }
}
