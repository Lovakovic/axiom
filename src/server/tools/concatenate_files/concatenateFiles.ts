import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

const SKIP_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "bmp", "tiff",
  "ttf", "woff", "woff2", "eot", "otf",
  "mp3", "mp4", "wav", "ogg", "webm", "avi", "mov",
  "zip", "tar", "gz", "rar", "7z",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "map", "min.js", "min.css",
  "exe", "dll", "so", "dylib"
];

function shouldSkipFile(filePath: string): boolean {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return SKIP_EXTENSIONS.includes(extension);
}

interface ToolParams {
  paths: string[];
}

async function processPath(currentPath: string, concatenatedContent: string[]): Promise<void> {
  const stats = await fs.promises.stat(currentPath);

  if (stats.isDirectory()) {
    if (currentPath.includes("node_modules") || path.basename(currentPath).startsWith(".")) {
      return;
    }
    const files = await fs.promises.readdir(currentPath);
    for (const file of files) {
      await processPath(path.join(currentPath, file), concatenatedContent);
    }
  } else if (stats.isFile()) {
    if (path.basename(currentPath).startsWith(".") || shouldSkipFile(currentPath)) {
      return;
    }
    try {
      const content = await fs.promises.readFile(currentPath, "utf-8");
      concatenatedContent.push(`// ${currentPath}\n${content}\n`);
    } catch (error: any) {
      // Log warning for unreadable files, but continue processing
      console.warn(`Warning: Skipping unreadable or non-UTF-8 file: ${currentPath} (Error: ${error.message})`);
    }
  }
}

export const toolDefinition: Tool = {
  name: "concatenate_files",
  description: "Concatenates specified text files or all text files in specified directories into a single string.",
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: {type: "string"},
        description: "An array of file or directory paths to concatenate."
      }
    },
    required: ["paths"]
  }
};

export async function concatenateFiles(params: ToolParams): Promise<CallToolResult> {
  const {paths} = params;
  const concatenatedContent: string[] = [];

  if (!paths || paths.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: "Error: No input paths specified."
        }
      ]
    };
  }

  for (const p of paths) {
    try {
      await processPath(p, concatenatedContent);
    } catch (error: any) {
      // Log error for non-existent paths, but continue processing other paths
      console.error(`Error processing path ${p}: ${error.message}`);
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: concatenatedContent.join("\n")
      }
    ]
  };
}
