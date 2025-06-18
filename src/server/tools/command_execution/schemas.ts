import { JSONSchemaDraft7 } from '../../../shared/util/types'; // Adjusted path
import { convertJSONSchemaDraft7ToZod } from '../../../shared/util/draftToZod'; // Adjusted path

export const executeCommandJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    command: {type: "string", description: "The shell command to execute. When the command contains user-provided data or special characters, ensure proper escaping for shell safety. Use quotes around arguments containing spaces or special characters."},
    timeout_ms: {
      type: "number",
      description: "Initial timeout in milliseconds to wait for the command to potentially complete or yield first output. If it times out, it's considered a long-running command. This is ignored if 'await_completion' is true."
    },
    await_completion: {
      type: "boolean",
      description: "If true, the tool will wait for the command to finish completely before returning, ignoring 'timeout_ms'. The full output and exit code will be returned."
    },
    shell: {
      type: "string",
      description: "Optional shell to use (e.g., 'bash', 'powershell.exe'). Defaults to OS default."
    },
    cwd: {type: "string", description: "Optional current working directory for the command."}
  },
  required: ["command"]
};
export const ExecuteCommandArgsSchema = convertJSONSchemaDraft7ToZod(executeCommandJSONSchema);


export const readOutputJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    pid: {type: "number", description: "The Process ID of the command to read output from."},
    timeout_ms: {type: "number", description: "Timeout in milliseconds to wait for new output."}
  },
  required: ["pid"]
};
export const ReadOutputArgsSchema = convertJSONSchemaDraft7ToZod(readOutputJSONSchema);


export const forceTerminateJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    pid: {type: "number", description: "The Process ID of the command to terminate."}
  },
  required: ["pid"]
};
export const ForceTerminateArgsSchema = convertJSONSchemaDraft7ToZod(forceTerminateJSONSchema);


export const listSessionsJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {}
};
export const ListSessionsArgsSchema = convertJSONSchemaDraft7ToZod(listSessionsJSONSchema);