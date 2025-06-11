import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { terminalManager } from "./terminalManager";
import {
  executeCommandJSONSchema,
  ExecuteCommandArgsSchema,
  readOutputJSONSchema,
  ReadOutputArgsSchema,
  forceTerminateJSONSchema,
  ForceTerminateArgsSchema,
  listSessionsJSONSchema,
  ListSessionsArgsSchema
} from "./schemas";
import { CMD_PREFIX_DESCRIPTION, PATH_GUIDANCE } from "../common/utils";


export const executeCommandToolDefinition: Tool = {
  name: "execute_command",
  description: `
Execute a shell command.
By default, it returns a Process ID (PID) and initial output. If the command doesn't complete quickly, 'isBlocked' will be true, and you should use 'read_output' to get further output or 'force_terminate' to stop it.
Use the 'await_completion: true' option to wait for the command to finish and get the full output and exit code directly.

Interactive commands (sudo, ssh, passwd, su, mysql, psql, etc.) are executed with terminal access to allow password input. These commands do not support process management features (read_output, force_terminate).

${PATH_GUIDANCE} (If your command involves file paths)
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: executeCommandJSONSchema // Corrected
};

// Handler still uses Zod-parsed args for type safety
export async function executeCommandHandler(args: z.infer<typeof ExecuteCommandArgsSchema>): Promise<CallToolResult> {
  // Default values for optional params if not provided and not handled by Zod .default()
  const timeoutMs = args.timeout_ms ?? 10000;
  const shell = args.shell; // undefined if not provided
  const cwd = args.cwd; // undefined if not provided
  const awaitCompletion = args.await_completion ?? false;

  const result = await terminalManager.executeCommand(args.command, timeoutMs, shell, cwd, awaitCompletion);

  // Handle interactive commands (PID -2) first
  if (result.pid === -2) {
    let outputText = `Interactive command executed.`;
    if (result.initialOutput) {
      outputText += `\nOutput:\n${result.initialOutput}`;
    }
    if (result.error) {
      outputText += `\nNote: ${result.error}`;
    }
    outputText += '\n\nNote: Process management features (read_output, force_terminate) are not available for interactive commands.';
    return {
      content: [{ type: 'text', text: outputText }],
      isError: !!result.error && result.exitCode !== 0
    };
  }

  if (result.error || result.pid === -1) {
    return {
      content: [{ type: 'text', text: `Error executing command: ${result.error || result.initialOutput}` }],
      isError: true,
    };
  }

  if (awaitCompletion) {
    // Case 1: Command was awaited and has now completed.
    let outputText = `Command PID ${result.pid} completed with exit code ${result.exitCode}.`;
    if (result.initialOutput) { // This field now contains the FULL output.
      outputText += `\nOutput:\n${result.initialOutput}`;
    }
    return {
      content: [{ type: 'text', text: outputText }]
    };
  }

  // Case 2: Command was not awaited.
  let outputText = `Command started with PID ${result.pid}.`;
  if (result.initialOutput) {
    outputText += `\nInitial output:\n${result.initialOutput}`;
  }
  if (result.isBlocked) {
    // Case 2a: Timed out, now running in the background.
    outputText += '\nCommand is still running. Use read_output to get more output or force_terminate to stop it.';
  } else {
    // Case 2b: Finished quickly (before the timeout).
    outputText += `\nCommand finished quickly with exit code ${result.exitCode}.`;
  }

  return {
    content: [{ type: 'text', text: outputText }]
  };
}

export const readOutputToolDefinition: Tool = {
  name: "read_output",
  description: `
Read new output from a running command, identified by its PID.
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: readOutputJSONSchema // Corrected
};

export async function readOutputHandler(args: z.infer<typeof ReadOutputArgsSchema>): Promise<CallToolResult> {
  const { pid } = args;
  const timeout_ms = args.timeout_ms ?? 5000;


  const outputPromise = new Promise<string | null>((resolve) => {
    let outputCheckInterval: NodeJS.Timeout | null = null;
    const giveUpTimeout = setTimeout(() => {
      if (outputCheckInterval) clearInterval(outputCheckInterval);
      resolve(terminalManager.readNewOutput(pid) ?? null);
    }, timeout_ms);

    const checkOutput = () => {
      const newOutput = terminalManager.readNewOutput(pid);
      if (newOutput !== null && newOutput !== '') {
        if (outputCheckInterval) clearInterval(outputCheckInterval);
        clearTimeout(giveUpTimeout);
        resolve(newOutput);
      } else if (terminalManager.getSessionStatus(pid) === 'completed') {
        if (outputCheckInterval) clearInterval(outputCheckInterval);
        clearTimeout(giveUpTimeout);
        resolve(terminalManager.readNewOutput(pid));
      }
    };

    const initialOutput = terminalManager.readNewOutput(pid);
    if (initialOutput !== null && initialOutput !== '') {
      clearTimeout(giveUpTimeout);
      resolve(initialOutput);
      return;
    } else if (terminalManager.getSessionStatus(pid) === 'completed') {
      clearTimeout(giveUpTimeout);
      resolve(terminalManager.readNewOutput(pid));
      return;
    }

    outputCheckInterval = setInterval(checkOutput, 300);
  });

  const output = await outputPromise;

  if (output === null) {
    return { content: [{ type: 'text', text: `No new output for PID ${pid}, or PID not found.` }] };
  }
  return { content: [{ type: 'text', text: output }] };
}


export const forceTerminateToolDefinition: Tool = {
  name: "force_terminate",
  description: `
Force terminate a running command by its PID.
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: forceTerminateJSONSchema // Corrected
};

export async function forceTerminateHandler(args: z.infer<typeof ForceTerminateArgsSchema>): Promise<CallToolResult> {
  const success = terminalManager.forceTerminate(args.pid);
  return {
    content: [{
      type: 'text',
      text: success
        ? `Termination signal sent to PID ${args.pid}. Use 'read_output' or 'list_sessions' to confirm termination.`
        : `Failed to send termination signal to PID ${args.pid}, or PID not found/already terminated.`
    }]
  };
}

export const listSessionsToolDefinition: Tool = {
  name: "list_sessions",
  description: `
List all active command sessions started by 'execute_command'.
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: listSessionsJSONSchema // Corrected
};

export async function listSessionsHandler(_args: z.infer<typeof ListSessionsArgsSchema>): Promise<CallToolResult> {
  const sessions = terminalManager.listActiveSessions();
  if (sessions.length === 0) {
    return { content: [{ type: 'text', text: 'No active command sessions.' }] };
  }
  const report = sessions.map(s =>
    `PID: ${s.pid}, Command: "${s.command}", CWD: ${s.cwd || 'default'}, Shell: ${s.shell || 'default'}, Running since: ${s.startTime.toISOString()}, Status: ${s.isBlocked ? 'Running in background' : 'Potentially finished or quick command'}`
  ).join('\n');
  return {
    content: [{ type: 'text', text: `Active sessions:\n${report}` }]
  };
}