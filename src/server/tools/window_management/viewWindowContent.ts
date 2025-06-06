import { Tool, CallToolResult, ImageContent } from "@modelcontextprotocol/sdk/types.js";
import { exec, ExecOptions } from "child_process";
import util from "util";
import os from "os";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const execPromise = util.promisify(exec);

async function commandExists(command: string): Promise<boolean> {
  try {
    await execPromise(`command -v ${command}`, { env: {} });
    return true;
  } catch (error) {
    return false;
  }
}

interface ToolParams {
  window_id: string;
}

export const toolDefinition: Tool = {
  name: "view_window_content",
  description: "Captures a screenshot of a specific window identified by its ID and returns it as a base64 encoded image. The window ID is typically obtained from the 'list_open_windows' tool.",
  inputSchema: {
    type: "object",
    properties: {
      window_id: {
        type: "string",
        description: "The ID of the window to capture. For Linux, this is usually a hex ID (e.g., 0x123abc). For macOS, this is usually a decimal ID."
      }
    },
    required: ["window_id"]
  }
};

function createX11ExecOptions(baseEnv: NodeJS.ProcessEnv, displayValue: string | undefined): ExecOptions {
  const execEnv: NodeJS.ProcessEnv = { ...baseEnv };

  if (displayValue) {
    execEnv.DISPLAY = displayValue;
  } else if (!execEnv.DISPLAY) {
    // Fallback handled by caller's iteration
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

async function captureWindowLinux(windowId: string, tempFilePath: string): Promise<void> {
  if (!await commandExists("import")) {
    throw new Error("import (ImageMagick) command not found. Please install ImageMagick (e.g., 'sudo apt-get install imagemagick').");
  }

  const potentialDisplays: Array<string | undefined> = [
    process.env.DISPLAY,
    ':1', // Your common display
    ':0',
    ':2'
  ].filter((v, i, a) => v === undefined || a.indexOf(v) === i);

  let lastError: Error | null = null;

  for (const display of potentialDisplays) {
    try {
      const execOptions = createX11ExecOptions(process.env, display);
      const { stdout, stderr } = await execPromise(`import -window "${windowId}" "${tempFilePath}"`, execOptions);

      // Check for critical errors in stderr
      if (stderr && (stderr.toLowerCase().includes("cannot open display") || stderr.toLowerCase().includes("no display"))) {
        lastError = new Error(`import command error on DISPLAY ${display ?? 'undefined'}: ${stderr.trim()}`);
        continue;
      }
      // If import succeeded, the file should exist. If not, it's an error for this display attempt.
      try {
        await fs.stat(tempFilePath);
        return; // Success, file created
      } catch (statError) {
        lastError = new Error(`import did not create file on DISPLAY ${display ?? 'undefined'}. Stderr: ${stderr || 'none'}. Stdout: ${stdout || 'none'}`);
        continue; // Ensure we try the next display if file not created
      }
    } catch (error: any) {
      lastError = error;
      if (error.message?.toLowerCase().includes("cannot open display") ||
        error.stderr?.toLowerCase().includes("cannot open display") ||
        error.message?.toLowerCase().includes("no display") ||
        error.stderr?.toLowerCase().includes("no display")) {
        continue;
      }
      // If the error is not a display-related one, it might be a more fundamental issue with 'import' or arguments.
      // In this case, we might not want to continue trying other displays as they would likely fail too.
      // However, for robustness in finding *a* working display, we could opt to continue.
      // For now, let's break if it's not a known display error.
      // Re-evaluating this: if execPromise fails, it's an error for *that specific DISPLAY attempt*.
      // We should always continue to try other displays unless the error is catastrophic and unrelated to DISPLAY.
      // The current logic to continue on "cannot open display" is good.
      // If it's another error type from execPromise, it will be stored in lastError.
      // If the loop finishes without success, the lastError (which could be from any attempt) is thrown.
      // This seems reasonable. The key fix was the `continue` after fs.stat failure.
    }
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error("Failed to capture window after trying common DISPLAY values. Ensure ImageMagick is installed and X11 server is accessible.");
}

async function captureWindowMacOs(windowId: string, tempFilePath: string): Promise<void> {
  await execPromise(`screencapture -o -l "${windowId}" "${tempFilePath}"`);
}

export async function viewWindowContentHandler(params: ToolParams): Promise<CallToolResult> {
  const { window_id } = params;
  const format = "png";
  const mimeType = `image/${format}`;
  const tempFileName = `${uuidv4()}.${format}`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);

  try {
    const platform = os.platform();
    if (platform === "linux") {
      await captureWindowLinux(window_id, tempFilePath);
    } else if (platform === "darwin") {
      await captureWindowMacOs(window_id, tempFilePath);
    } else {
      return {
        content: [{ type: "text", text: `Unsupported platform: ${platform}` }],
        isError: true,
      };
    }

    const fileData = await fs.readFile(tempFilePath);
    const base64Data = fileData.toString("base64")

    const imageContent: ImageContent = {
      type: "image",
      data: base64Data,
      mimeType: mimeType,
    };

    return {
      content: [imageContent]
    };

  } catch (error: any) {
    let errorMessage = `Error capturing window content: ${error.message}`;
    if (error.stderr && !error.message.includes(error.stderr)) {
      errorMessage += `\nStderr: ${error.stderr}`;
    }
    return {
      content: [{ type: "text", text: errorMessage }],
      isError: true,
    };
  } finally {
    try {
      await fs.stat(tempFilePath);
      await fs.unlink(tempFilePath);
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        // Silently ignore if file wasn't created or already deleted
      }
    }
  }
}
