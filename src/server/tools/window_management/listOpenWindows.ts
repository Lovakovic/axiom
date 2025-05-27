import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { exec, ExecOptions } from "child_process";
import util from "util";
import os from "os";

const execPromise = util.promisify(exec);

async function commandExists(command: string): Promise<boolean> {
  try {
    await execPromise(`command -v ${command}`, { env: {} });
    return true;
  } catch (error) {
    return false;
  }
}

interface WindowInfo {
  id: string;
  title: string;
  app?: string;
}

export const toolDefinition: Tool = {
  name: "list_open_windows",
  description: "Lists currently open windows on the user's desktop, providing their IDs and titles. On macOS, it also provides the application name.",
  inputSchema: {
    type: "object",
    properties: {},
  }
};

function createX11ExecOptions(baseEnv: NodeJS.ProcessEnv, displayValue: string | undefined): ExecOptions {
  const execEnv: NodeJS.ProcessEnv = { ...baseEnv };

  if (displayValue) {
    execEnv.DISPLAY = displayValue;
  } else if (!execEnv.DISPLAY) {
    // This function primarily relies on the caller to provide a displayValue
    // or for it to be in baseEnv. A hardcoded default here is less ideal.
  }

  if (!execEnv.XAUTHORITY && os.platform() !== 'win32') {
    const homeDir = os.homedir();
    execEnv.XAUTHORITY = `${homeDir}/.Xauthority`;
  }

  if (!execEnv.PATH && baseEnv.PATH) {
    execEnv.PATH = baseEnv.PATH;
  }

  return { env: execEnv };
}

async function listOpenWindowsLinux(): Promise<WindowInfo[]> {
  if (!await commandExists("wmctrl")) {
    throw new Error("wmctrl command not found. Please install it (e.g., 'sudo apt-get install wmctrl').");
  }

  const potentialDisplays: Array<string | undefined> = [
    process.env.DISPLAY,
    ':1', // Your common display
    ':0',
    ':2'
  ].filter((v, i, a) => v === undefined || a.indexOf(v) === i); // Keep undefined only once if present, then unique defined values

  let lastError: Error | null = null;

  for (const display of potentialDisplays) {
    try {
      const execOptions = createX11ExecOptions(process.env, display);
      const { stdout, stderr } = await execPromise("wmctrl -l", execOptions);

      if (stderr && stderr.toLowerCase().includes("cannot open display")) {
        lastError = new Error(`wmctrl error on DISPLAY ${display ?? 'undefined'}: ${stderr.trim()}`);
        continue;
      }
      // If stderr has other content, it might be a non-fatal warning, or wmctrl might still have worked.
      // If stdout is empty and there was a stderr, that might indicate a failure.
      if (!stdout.trim() && stderr.trim()) {
        // If wmctrl didn't produce output and had an error (not "cannot open display"),
        // treat it as an error for this display attempt.
        lastError = new Error(`wmctrl produced no output and had stderr on DISPLAY ${display ?? 'undefined'}: ${stderr.trim()}`);
        continue;
      }

      const lines = stdout.trim().split("\n").filter(line => line.trim() !== "");
      if (lines.length === 0 && stdout.trim() === "" && !stderr.toLowerCase().includes("cannot open display")){
        // No windows, or command succeeded but found nothing without a display error
      }

      const windows: WindowInfo[] = [];
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          const id = parts[0];
          const title = parts.slice(3).join(" ");
          if (id && title.trim() !== "") {
            windows.push({ id, title });
          }
        }
      }
      return windows; // Success
    } catch (error: any) {
      lastError = error; // Store error from execPromise itself
      if (error.message?.toLowerCase().includes("cannot open display") ||
        error.stderr?.toLowerCase().includes("cannot open display")) {
        // This specific error means we should try the next display
        continue;
      }
      // For other errors, we might not want to continue trying other displays,
      // but for simplicity in this loop, we'll let it try, and throw the last error.
    }
  }

  if (lastError) {
    throw lastError;
  }
  // This should ideally not be reached if potentialDisplays has at least one attempt.
  // If process.env.DISPLAY was undefined and all fallbacks failed.
  throw new Error("Failed to list windows after trying common DISPLAY values. Ensure X11 server is accessible.");
}

async function listOpenWindowsMacOs(): Promise<WindowInfo[]> {
  const script = `
    set outputList to {}
    tell application "System Events"
        set procs to (every application process whose background only is false and visible is true)
        repeat with proc in procs
            try
                set procName to name of proc
                set appWindows to windows of proc
                repeat with w in appWindows
                    try
                        set winName to name of w
                        set winId to id of w
                        if winName is not "" and winName is not missing value then
                            set end of outputList to (winId as text) & ":::" & procName & ":::" & winName
                        end if
                    on error
                    end try
                end repeat
            on error
            end try
        end repeat
    end tell
    return outputList
  `;
  const { stdout } = await execPromise(`osascript -e '${script}'`);
  const rawOutput = stdout.trim();
  if (rawOutput === "") {
    return [];
  }
  const lines = rawOutput.split(", ");
  const windows: WindowInfo[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const parts = line.split(":::");
    if (parts.length === 3) {
      windows.push({ id: parts[0], app: parts[1], title: parts[2] });
    }
  }
  return windows;
}

export async function listOpenWindowsHandler(_params: {}): Promise<CallToolResult> {
  let windows: WindowInfo[];
  try {
    const platform = os.platform();
    if (platform === "linux") {
      windows = await listOpenWindowsLinux();
    } else if (platform === "darwin") {
      windows = await listOpenWindowsMacOs();
    } else {
      return {
        content: [{ type: "text", text: `Unsupported platform: ${platform}` }],
        isError: true,
      };
    }

    if (windows.length === 0) {
      return { content: [{ type: "text", text: "No open windows found or accessible." }] };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(windows, null, 2) }]
    };
  } catch (error: any) {
    let errorMessage = `Error listing open windows: ${error.message}`;
    if (error.stderr && !error.message.includes(error.stderr)) {
      errorMessage += `\nStderr: ${error.stderr}`;
    }
    return {
      content: [{ type: "text", text: errorMessage }],
      isError: true,
    };
  }
}
