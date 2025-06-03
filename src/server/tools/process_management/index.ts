import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { exec } from "child_process";
import util from "util";
import os from "os";
import {
  listProcessesJSONSchema, ListProcessesArgsSchema,
  killProcessJSONSchema, KillProcessArgsSchema
} from "./schemas";
import { CMD_PREFIX_DESCRIPTION } from "../common/utils";

const execPromise = util.promisify(exec);

interface ProcessInfo {
  pid: string;
  ppid?: string;
  cpu?: string;
  mem?: string;
  command: string;
  user?: string;
}

export const listProcessesToolDefinition: Tool = {
  name: "list_processes",
  description: `
List currently running processes on the system.
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: listProcessesJSONSchema
};

export async function listProcessesHandler(_args: z.infer<typeof ListProcessesArgsSchema>): Promise<CallToolResult> {
  try {
    let command: string;
    let processParser: (line: string) => ProcessInfo | null;

    if (os.platform() === 'win32') {
      command = 'WMIC PROCESS GET ProcessId,ParentProcessId,Name,KernelModeTime,UserModeTime,WorkingSetSize,UserAccount /FORMAT:CSV';
      processParser = (line: string): ProcessInfo | null => {
        const parts = line.split(',');
        if (parts.length < 7 || parts[0].toLowerCase() === 'node' || parts[1].toLowerCase() === 'name' || parts[2].toLowerCase() === 'processid') return null;
        return {
          command: parts[1] || "N/A",
          mem: parts[5] ? ((parseInt(parts[5])) / (1024*1024)).toFixed(2) + "MB" : "N/A",
          pid: parts[2] || "N/A",
          ppid: parts[3] || "N/A",
          user: parts[6] || "N/A",
        };
      };
    } else { // Linux, macOS
      command = 'ps -axo pid,ppid,pcpu,pmem,user,command --no-headers';
      processParser = (line: string): ProcessInfo | null => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) return null;
        return {
          pid: parts[0],
          ppid: parts[1],
          cpu: parts[2] + "%",
          mem: parts[3] + "%",
          user: parts[4],
          command: parts.slice(5).join(' '),
        };
      };
    }

    const { stdout } = await execPromise(command);
    const processes = stdout.trim().split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(processParser)
      .filter((p): p is ProcessInfo => p !== null);

    if (processes.length === 0) {
      return { content: [{ type: 'text', text: "No processes found or could not parse process list." }] };
    }

    const report = processes.map(p =>
      `PID: ${p.pid}, PPID: ${p.ppid || 'N/A'}, User: ${p.user || 'N/A'}, CPU: ${p.cpu || 'N/A'}, MEM: ${p.mem || 'N/A'}, CMD: ${p.command}`
    ).join('\n');
    return { content: [{ type: 'text', text: `Running processes:\n${report}` }] };

  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error listing processes: ${error.message}` }], isError: true };
  }
}

export const killProcessToolDefinition: Tool = {
  name: "kill_process",
  description: `
Terminate a process by its PID. Use with caution.
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: killProcessJSONSchema
};

export async function killProcessHandler(args: z.infer<typeof KillProcessArgsSchema>): Promise<CallToolResult> {
  try {
    const pidToKill = args.pid;
    const signal = args.signal ?? "SIGTERM";
    let command: string;

    if (os.platform() === 'win32') {
      command = `taskkill /PID ${pidToKill} /F`;
    } else {
      let signalNum = '-15'; // SIGTERM
      if (signal === 'SIGKILL') signalNum = '-9';
      else if (signal === 'SIGINT') signalNum = '-2';
      command = `kill ${signalNum} ${pidToKill}`;
    }
    await execPromise(command);
    return { content: [{ type: 'text', text: `Signal ${signal} sent to process ${pidToKill}.` }] };
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error terminating process ${args.pid}: ${error.message}` }], isError: true };
  }
}