import { CallToolResult, Tool, TextContent, ImageContent } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import fetch from "cross-fetch";
import os from "os";

import {
  normalizeAndEnsurePath,
  getMimeType,
  isImageMimeType,
  isTextMimeType,
  detectLineEnding,
  normalizeLineEndings,
  PATH_GUIDANCE,
  CMD_PREFIX_DESCRIPTION,
  DEFAULT_FILE_READ_LINE_LIMIT,
  DEFAULT_FILE_WRITE_LINE_LIMIT
} from "../common/utils";
import {
  readFileJSONSchema, ReadFileArgsSchema,
  readMultipleFilesJSONSchema, ReadMultipleFilesArgsSchema,
  writeFileJSONSchema, WriteFileArgsSchema,
  createDirectoryJSONSchema, CreateDirectoryArgsSchema,
  listDirectoryJSONSchema, ListDirectoryArgsSchema,
  moveFileJSONSchema, MoveFileArgsSchema,
  getFileInfoJSONSchema, GetFileInfoArgsSchema
} from "./schemas";

// Helper interfaces for internal use
interface FileReadResult {
  content: string; // Base64 for images, text for others
  mimeType: string;
  isImage: boolean;
  isText: boolean;
  originalPath: string;
  resolvedPath: string;
  error?: string;
  message?: string; // e.g. truncation notice
}

async function readFileContent(
  filePathOrUrl: string,
  isUrl: boolean,
  offset: number,
  length: number
): Promise<FileReadResult> {
  const originalPath = filePathOrUrl;
  let resolvedPath = originalPath;
  try {
    if (isUrl) {
      resolvedPath = new URL(filePathOrUrl).toString(); // Validate and normalize URL
      const response = await fetch(resolvedPath);
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const mimeType = response.headers.get('content-type') || getMimeType(resolvedPath);
      const isImage = isImageMimeType(mimeType);
      const isText = isTextMimeType(mimeType);

      if (isImage) {
        const buffer = await response.arrayBuffer();
        return {
          content: Buffer.from(buffer).toString('base64'),
          mimeType,
          isImage,
          isText: false,
          originalPath,
          resolvedPath
        };
      } else if (isText) {
        const text = await response.text();
        // Line-based offset/length doesn't make sense for arbitrary URLs; return full for text
        return {content: text, mimeType, isImage: false, isText: true, originalPath, resolvedPath};
      } else { // Binary non-image
        const buffer = await response.arrayBuffer();
        return {
          content: Buffer.from(buffer).toString('base64'),
          mimeType,
          isImage: false,
          isText: false,
          originalPath,
          resolvedPath,
          message: "Binary content returned as base64."
        };
      }
    } else {
      resolvedPath = await normalizeAndEnsurePath(filePathOrUrl);
      const stats = await fs.stat(resolvedPath);
      if (stats.isDirectory()) throw new Error("Path is a directory, not a file.");

      const mimeType = getMimeType(resolvedPath);
      const isImage = isImageMimeType(mimeType);
      const isText = isTextMimeType(mimeType);

      if (isImage) {
        const data = await fs.readFile(resolvedPath);
        return {content: data.toString('base64'), mimeType, isImage, isText: false, originalPath, resolvedPath};
      } else { // Text or other binary
        const fileBuffer = await fs.readFile(resolvedPath);
        if (isText || mimeType === 'application/octet-stream') { // Attempt to read as text if mime hints or unknown
          let textContent = fileBuffer.toString('utf-8');
          const lines = textContent.split('\n');
          const totalLines = lines.length;
          let message = `Total lines: ${totalLines}. `;

          let startLine = Math.min(offset, totalLines);
          let endLine = Math.min(startLine + length, totalLines);

          if (offset >= totalLines && totalLines > 0) {
            message += `Offset ${offset} is beyond file end. `;
            return {
              content: "",
              mimeType,
              isImage: false,
              isText: true,
              originalPath,
              resolvedPath,
              message: message + "No content at this offset."
            };
          }

          const selectedLines = lines.slice(startLine, endLine);
          message += `Reading lines ${startLine + 1} to ${endLine}.`;
          return {
            content: selectedLines.join('\n'),
            mimeType,
            isImage: false,
            isText: true,
            originalPath,
            resolvedPath,
            message
          };
        } else { // Other binary
          return {
            content: fileBuffer.toString('base64'),
            mimeType,
            isImage: false,
            isText: false,
            originalPath,
            resolvedPath,
            message: "Binary content returned as base64."
          };
        }
      }
    }
  } catch (error: any) {
    return {
      content: '',
      mimeType: 'application/octet-stream',
      isImage: false,
      isText: false,
      error: error.message,
      originalPath,
      resolvedPath
    };
  }
}

export const readFileToolDefinition: Tool = {
  name: "read_file",
  description: `
Read content of a local file or a URL.
For text files, supports line-based offset and length. Images are returned as base64.
${PATH_GUIDANCE} (For local files)
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: readFileJSONSchema
};

export async function readFileHandler(args: z.infer<typeof ReadFileArgsSchema>): Promise<CallToolResult> {
  const isUrl = args.is_url ?? false;
  const offset = args.offset ?? 0;
  const length = args.length ?? DEFAULT_FILE_READ_LINE_LIMIT;

  const result = await readFileContent(args.path, isUrl, offset, length);
  const toolContent: (TextContent | ImageContent)[] = [];

  if (result.error) {
    return {content: [{type: 'text', text: `Error reading ${result.originalPath}: ${result.error}`}], isError: true};
  }

  let headerText = `Content from: ${result.originalPath}`;
  if (result.resolvedPath !== result.originalPath) headerText += ` (resolved to: ${result.resolvedPath})`;
  headerText += `\nMIME type: ${result.mimeType}.`;
  if (result.message) headerText += `\nNote: ${result.message}`;
  toolContent.push({type: 'text', text: headerText});

  if (result.isImage) {
    toolContent.push({type: 'image', data: result.content, mimeType: result.mimeType});
  } else { // Text or other base64 binary
    toolContent.push({type: 'text', text: `\n\n${result.content}`});
  }
  return {content: toolContent};
}

export const readMultipleFilesToolDefinition: Tool = {
  name: "read_multiple_files",
  description: `
Read content of multiple local files simultaneously.
${PATH_GUIDANCE}
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: readMultipleFilesJSONSchema
};

export async function readMultipleFilesHandler(args: z.infer<typeof ReadMultipleFilesArgsSchema>): Promise<CallToolResult> {
  const results = await Promise.all(
    args.paths.map((p: string) => readFileContent(p, false, 0, DEFAULT_FILE_READ_LINE_LIMIT))
  );

  const allToolContent: (TextContent | ImageContent)[] = [];
  let summaryText = "Batch file read summary:\n";

  for (const result of results) {
    summaryText += `- ${result.originalPath}: ${result.error ? `Error (${result.error})` : `Success (${result.mimeType})`}\n`;
    if (!result.error) {
      let headerText = `\n--- Content from: ${result.originalPath} ---\n`;
      if (result.resolvedPath !== result.originalPath) headerText += `(Resolved to: ${result.resolvedPath})\n`;
      if (result.message) headerText += `Note: ${result.message}\n`;
      allToolContent.push({type: 'text', text: headerText});

      if (result.isImage) {
        allToolContent.push({type: 'image', data: result.content, mimeType: result.mimeType});
      } else {
        allToolContent.push({type: 'text', text: result.content});
      }
    }
  }
  allToolContent.unshift({type: 'text', text: summaryText});
  return {content: allToolContent};
}


export const writeFileToolDefinition: Tool = {
  name: "write_file",
  description: `
Write or append content to a local file.
WARNING: Content exceeding 'max_lines_per_write' (default ${DEFAULT_FILE_WRITE_LINE_LIMIT}) WILL BE REJECTED.
Agent MUST split large content into multiple calls: first with mode 'rewrite', subsequent with 'append'.
${PATH_GUIDANCE}
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: writeFileJSONSchema
};

export async function writeFileHandler(args: z.infer<typeof WriteFileArgsSchema>): Promise<CallToolResult> {
  try {
    const resolvedPath = await normalizeAndEnsurePath(args.path);
    const lineCount = args.content.split('\n').length;
    const limit = args.max_lines_per_write ?? DEFAULT_FILE_WRITE_LINE_LIMIT;
    const mode = args.mode ?? 'rewrite';

    if (lineCount > limit) {
      return {
        content: [{
          type: 'text',
          text: `Error: Content for ${args.path} has ${lineCount} lines, exceeding the per-call limit of ${limit}. Please split into smaller chunks.`
        }],
        isError: true,
      };
    }

    let originalLineEnding = os.platform() === 'win32' ? '\r\n' : '\n' as ReturnType<typeof detectLineEnding>;
    try {
      const stat = await fs.stat(resolvedPath);
      if (stat.isFile()) {
        const currentContent = await fs.readFile(resolvedPath, 'utf-8');
        originalLineEnding = detectLineEnding(currentContent);
      }
    } catch (e) { /* File might not exist, use system default */
    }

    const contentToWrite = normalizeLineEndings(args.content, originalLineEnding);

    if (mode === 'append') {
      await fs.appendFile(resolvedPath, contentToWrite, 'utf-8');
    } else {
      await fs.writeFile(resolvedPath, contentToWrite, 'utf-8');
    }
    return {
      content: [{
        type: 'text',
        text: `Successfully ${mode === 'append' ? 'appended to' : 'wrote to'} ${resolvedPath} (${lineCount} lines).`
      }]
    };
  } catch (error: any) {
    return {content: [{type: 'text', text: `Error writing file ${args.path}: ${error.message}`}], isError: true};
  }
}

export const createDirectoryToolDefinition: Tool = {
  name: "create_directory",
  description: `
Create a new directory, including any necessary parent directories.
${PATH_GUIDANCE}
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: createDirectoryJSONSchema
};

export async function createDirectoryHandler(args: z.infer<typeof CreateDirectoryArgsSchema>): Promise<CallToolResult> {
  try {
    const resolvedPath = await normalizeAndEnsurePath(args.path);
    await fs.mkdir(resolvedPath, {recursive: true});
    return {content: [{type: 'text', text: `Successfully created directory ${resolvedPath}`}]};
  } catch (error: any) {
    return {content: [{type: 'text', text: `Error creating directory ${args.path}: ${error.message}`}], isError: true};
  }
}

export const listDirectoryToolDefinition: Tool = {
  name: "list_directory",
  description: `
List files and subdirectories within a specified directory.
${PATH_GUIDANCE}
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: listDirectoryJSONSchema
};

async function listDirectoryRecursiveInternal(dirPath: string, currentDepth: number, maxDepth: number): Promise<string[]> {
  const entries = await fs.readdir(dirPath, {withFileTypes: true});
  let results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    const type = entry.isDirectory() ? '[DIR] ' : '[FILE]';
    results.push(`${type}${entryPath}`); // Push full path for recursive clarity
    if (entry.isDirectory() && currentDepth < maxDepth) {
      results = results.concat(await listDirectoryRecursiveInternal(entryPath, currentDepth + 1, maxDepth));
    }
  }
  return results;
}

export async function listDirectoryHandler(args: z.infer<typeof ListDirectoryArgsSchema>): Promise<CallToolResult> {
  try {
    const resolvedPath = await normalizeAndEnsurePath(args.path);
    const recursive = args.recursive ?? false;
    const depth = args.depth ?? 1;
    let entriesList: string[];

    if (recursive) {
      entriesList = await listDirectoryRecursiveInternal(resolvedPath, 1, depth);
    } else {
      const entries = await fs.readdir(resolvedPath, {withFileTypes: true});
      entriesList = entries.map(entry => {
        const type = entry.isDirectory() ? '[DIR] ' : '[FILE]';
        return `${type}${entry.name}`; // Only name for non-recursive
      });
    }

    if (entriesList.length === 0) {
      return {content: [{type: 'text', text: `Directory ${resolvedPath} is empty or contains no accessible items.`}]};
    }
    return {content: [{type: 'text', text: `Contents of ${resolvedPath}:\n${entriesList.join('\n')}`}]};
  } catch (error: any) {
    return {content: [{type: 'text', text: `Error listing directory ${args.path}: ${error.message}`}], isError: true};
  }
}

export const moveFileToolDefinition: Tool = {
  name: "move_file",
  description: `
Move or rename a file or directory.
${PATH_GUIDANCE}
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: moveFileJSONSchema
};

export async function moveFileHandler(args: z.infer<typeof MoveFileArgsSchema>): Promise<CallToolResult> {
  try {
    const resolvedSource = await normalizeAndEnsurePath(args.source);
    const resolvedDestination = await normalizeAndEnsurePath(args.destination);
    await fs.rename(resolvedSource, resolvedDestination);
    return {content: [{type: 'text', text: `Successfully moved ${resolvedSource} to ${resolvedDestination}`}]};
  } catch (error: any) {
    return {
      content: [{type: 'text', text: `Error moving ${args.source} to ${args.destination}: ${error.message}`}],
      isError: true
    };
  }
}

export const getFileInfoToolDefinition: Tool = {
  name: "get_file_info",
  description: `
Retrieve detailed information about a file or directory (size, type, timestamps, line count for text files).
${PATH_GUIDANCE}
${CMD_PREFIX_DESCRIPTION}`,
  inputSchema: getFileInfoJSONSchema
};

export async function getFileInfoHandler(args: z.infer<typeof GetFileInfoArgsSchema>): Promise<CallToolResult> {
  try {
    const resolvedPath = await normalizeAndEnsurePath(args.path);
    const stats = await fs.stat(resolvedPath);
    const info: Record<string, any> = {
      path: resolvedPath,
      type: stats.isDirectory() ? 'directory' : (stats.isFile() ? 'file' : 'other'),
      size_bytes: stats.size,
      created_at: stats.birthtime.toISOString(),
      modified_at: stats.mtime.toISOString(),
      accessed_at: stats.atime.toISOString(),
    };

    if (stats.isFile() && isTextMimeType(getMimeType(resolvedPath))) {
      try {
        // Limit reading large files for line count
        const MAX_SIZE_FOR_LINE_COUNT = 50 * 1024 * 1024; // 50MB
        if (stats.size <= MAX_SIZE_FOR_LINE_COUNT) {
          const content = await fs.readFile(resolvedPath, 'utf-8');
          const lines = content.split('\n');
          info.line_count = lines.length;
          info.last_line_number = Math.max(0, lines.length - 1);
          info.append_at_line = lines.length;
        } else {
          info.line_count_omitted = "File too large to count lines quickly.";
        }
      } catch (e) {
        info.line_count_error = "Could not read as text to count lines.";
      }
    }
    const report = Object.entries(info).map(([key, value]) => `${key}: ${value}`).join('\n');
    return {content: [{type: 'text', text: `File information for ${resolvedPath}:\n${report}`}]};
  } catch (error: any) {
    return {
      content: [{type: 'text', text: `Error getting file info for ${args.path}: ${error.message}`}],
      isError: true
    };
  }
}