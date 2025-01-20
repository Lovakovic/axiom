import { ImageResourceHandler } from './image-handler';
import { ResourceHandler } from './types';
import { Resource } from "@modelcontextprotocol/sdk/types.js";

export class ResourceManager {
  private readonly handlers: Map<string, ResourceHandler> = new Map();

  constructor() {
    // Initialize with the image handler
    this.registerHandler('image', new ImageResourceHandler());
  }

  registerHandler(type: string, handler: ResourceHandler) {
    this.handlers.set(type, handler);
  }

  async readResource(uri: string) {
    for (const handler of this.handlers.values()) {
      if (handler.isValidUri(uri)) {
        return await handler.read(uri);
      }
    }
    throw new Error(`No handler found for URI: ${uri}`);
  }

  async listAllResources(): Promise<Resource[]> {
    const resources: Resource[] = [];

    for (const handler of this.handlers.values()) {
      if ('listResources' in handler) {
        const handlerResources = await (handler as ImageResourceHandler).listResources();
        resources.push(...handlerResources);
      }
    }

    return resources;
  }
}