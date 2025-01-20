import { convertJSONSchemaDraft7ToZod } from "../../shared/util/draftToZod";
import { MCPClient } from "../client";
import { LocalTool } from "./base";
import { MessageContentComplex } from "@langchain/core/messages";

export function createViewImageTool(mcpClient: MCPClient): LocalTool {
  return new LocalTool({
    name: 'view-image',
    description: 'View an image located at a given path.',
    func: async (input: Record<string, unknown>): Promise<MessageContentComplex[]> => {
      const path = input['path'];
      if(!path || typeof path !== 'string') {
        throw new Error('Path must be a string.');
      }

      try {
        // Read the resource using MCPClient
        const result = await mcpClient.readResource(`file://${path}`);
        const content = result.contents[0];

        if (!('blob' in content)) {
          throw new Error('Not an image resource');
        }

        const imageData = mcpClient.getResourceData(content);

        return [{
          type: "image_url",
          image_url: imageData
        }];
      } catch (error) {
        throw new Error(`Failed to view image: ${error instanceof Error ? error.message : error}`);
      }
    },
    schema: convertJSONSchemaDraft7ToZod({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the image file'
        }
      },
      required: ['path'],
    }),
    outputFormat: {
      method: 'value',
      format: 'complex'
    }
  });
}