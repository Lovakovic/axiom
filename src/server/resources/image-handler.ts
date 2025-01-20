
import fs from 'fs/promises';
import path from 'path';
import mime from 'mime-types';
import os from 'os';
import { BlobResourceContents, Resource } from "@modelcontextprotocol/sdk/types.js";
import { ResourceHandler } from './types';

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);

export class ImageResourceHandler implements ResourceHandler {
  private readonly picturesDir: string;

  constructor() {
    const homeDir = os.homedir();
    this.picturesDir = path.join(homeDir, 'Pictures');
  }

  async read(uri: string): Promise<BlobResourceContents> {
    if (!this.isValidUri(uri)) {
      throw new Error(`Invalid image URI: ${uri}`);
    }

    const filePath = this.uriToPath(uri);

    try {
      const data = await fs.readFile(filePath);
      const mimeType = mime.lookup(filePath) || 'application/octet-stream';

      return {
        uri,
        mimeType,
        blob: data.toString('base64')
      };
    } catch (error) {
      throw new Error(`Failed to read image file: ${error instanceof Error ? error.message : error}`);
    }
  }

  isValidUri(uri: string): boolean {
    try {
      const filePath = this.uriToPath(uri);
      // Check if the file is within the Pictures directory
      if (!filePath.startsWith(this.picturesDir)) {
        return false;
      }
      const ext = path.extname(filePath).toLowerCase();
      return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
    } catch {
      return false;
    }
  }

  private uriToPath(uri: string): string {
    // Remove the "file://" prefix and decode the URI
    const decodedPath = decodeURIComponent(uri.replace(/^file:\/\//, ''));
    // For absolute paths, use as is; for relative paths, resolve from Pictures directory
    return path.isAbsolute(decodedPath) ? decodedPath : path.join(this.picturesDir, decodedPath);
  }

  async listResources(): Promise<Resource[]> {
    const resources: Resource[] = [];

    try {
      // List only files in the Pictures directory (non-recursive)
      const files = await fs.readdir(this.picturesDir, { withFileTypes: true });

      for (const file of files) {
        if (file.isFile()) {
          const ext = path.extname(file.name).toLowerCase();
          if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
            const uri = `file://${path.join(this.picturesDir, file.name)}`;
            const mimeType = mime.lookup(file.name) || 'application/octet-stream';

            resources.push({
              uri,
              name: file.name,
              description: `Image file: ${file.name}`,
              mimeType
            });
          }
        }
      }

      return resources;
    } catch (error) {
      console.error(`Error listing resources in ${this.picturesDir}:`, error);
      return [];
    }
  }
}