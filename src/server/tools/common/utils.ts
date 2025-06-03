import path from 'path';
import os from 'os';

/**
 * Expands ~ to user's home directory and resolves to an absolute path.
 * This version does NOT enforce allowed directories.
 */
export async function normalizeAndEnsurePath(requestedPath: string): Promise<string> {
  let expandedPath = requestedPath;
  if (requestedPath.startsWith('~/') || requestedPath === '~') {
    expandedPath = path.join(os.homedir(), requestedPath.slice(1));
  }

  const absolutePath = path.resolve(expandedPath);
  // For operations that create files/dirs, we might need to check parent.
  // For read operations, the operation itself will fail if path is invalid.
  // This simplified version focuses on normalization.
  return absolutePath;
}

/**
 * Executes a promise with a timeout.
 */
export function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  defaultValueOnTimeout?: T // Optional default value if timeout occurs
): Promise<T> {
  return new Promise((resolve, reject) => {
    let isCompleted = false;

    const timeoutId = setTimeout(() => {
      if (!isCompleted) {
        isCompleted = true;
        if (defaultValueOnTimeout !== undefined) {
          resolve(defaultValueOnTimeout);
        } else {
          reject(new Error(`Operation timed out after ${timeoutMs / 1000} seconds`));
        }
      }
    }, timeoutMs);

    operation
      .then(result => {
        if (!isCompleted) {
          isCompleted = true;
          clearTimeout(timeoutId);
          resolve(result);
        }
      })
      .catch(error => {
        if (!isCompleted) {
          isCompleted = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      });
  });
}

// Line Ending Utilities
export type LineEndingStyle = '\r\n' | '\n' | '\r';

export function detectLineEnding(content: string): LineEndingStyle {
  if (content.includes('\r\n')) return '\r\n';
  if (content.includes('\n')) return '\n';
  if (content.includes('\r')) return '\r';
  return os.platform() === 'win32' ? '\r\n' : '\n'; // System default
}

export function normalizeLineEndings(text: string, targetLineEnding: LineEndingStyle): string {
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (targetLineEnding === '\r\n') {
    return normalized.replace(/\n/g, '\r\n');
  } else if (targetLineEnding === '\r') {
    return normalized.replace(/\n/g, '\r');
  }
  return normalized;
}

// MIME Type Utilities
export function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase().slice(1);
  const imageTypes: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
  };
  if (extension in imageTypes) {
    return imageTypes[extension];
  }
  // Add more common types if needed
  const textTypes: Record<string, string> = {
    'txt': 'text/plain',
    'json': 'application/json',
    'js': 'application/javascript',
    'ts': 'application/typescript',
    'html': 'text/html',
    'css': 'text/css',
    'md': 'text/markdown',
    'xml': 'application/xml',
    'yaml': 'application/x-yaml',
    'yml': 'application/x-yaml',
  };
  if (extension in textTypes) {
    return textTypes[extension];
  }
  return 'application/octet-stream';
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml';
}

// Constants for tool descriptions (can be moved to a dedicated constants.ts if preferred)
export const PATH_GUIDANCE = `IMPORTANT: Always use absolute paths (starting with '/' or drive letter like 'C:\\') for reliability. Relative paths may fail. Tilde paths (~/...) are supported.`;
export const CMD_PREFIX_DESCRIPTION = `This tool interacts with the user's local desktop environment.`;

// Default limits if not provided by agent or config
export const DEFAULT_FILE_READ_LINE_LIMIT = 1000;
export const DEFAULT_FILE_WRITE_LINE_LIMIT = 50;