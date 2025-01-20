import { BlobResourceContents, TextResourceContents } from "@modelcontextprotocol/sdk/types.js";

export interface ResourceHandler {
  read(uri: string): Promise<TextResourceContents | BlobResourceContents>;
  isValidUri(uri: string): boolean;
}