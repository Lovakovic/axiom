import { JSONSchemaDraft7 } from '../../../shared/util/types';
import { convertJSONSchemaDraft7ToZod } from '../../../shared/util/draftToZod';

export const listProcessesJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {}
};
export const ListProcessesArgsSchema = convertJSONSchemaDraft7ToZod(listProcessesJSONSchema);

export const killProcessJSONSchema: JSONSchemaDraft7 = {
  type: "object",
  properties: {
    pid: { type: "number", description: "The Process ID of the process to terminate." },
    signal: { type: "string", description: "Optional signal to send (e.g., SIGKILL, SIGINT). Default is SIGTERM." }
  },
  required: ["pid"]
};
export const KillProcessArgsSchema = convertJSONSchemaDraft7ToZod(killProcessJSONSchema);