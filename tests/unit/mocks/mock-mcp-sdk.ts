// Mock implementation of @modelcontextprotocol/sdk
export class Client {
  constructor() {}
  
  connect() {
    return Promise.resolve();
  }
  
  disconnect() {
    return Promise.resolve();
  }
  
  callTool() {
    return Promise.resolve({
      content: [],
      isError: false,
    });
  }
  
  listTools() {
    return Promise.resolve({
      tools: [],
    });
  }
  
  listResources() {
    return Promise.resolve({
      resources: [],
    });
  }
  
  readResource() {
    return Promise.resolve({
      contents: [],
    });
  }
  
  listPrompts() {
    return Promise.resolve({
      prompts: [],
    });
  }
  
  getPrompt() {
    return Promise.resolve({
      messages: [],
    });
  }
}

export class StdioClientTransport {
  constructor() {}
  
  start() {
    return Promise.resolve();
  }
  
  close() {
    return Promise.resolve();
  }
}

export const Protocol = {
  // Mock protocol methods
};

// Export types
export interface CallToolResult {
  content: any[];
  isError?: boolean;
}

export interface ListToolsResult {
  tools: any[];
}

export interface BlobResourceContents {
  uri: string;
  blob: string;
  mimeType?: string;
}

export interface TextResourceContents {
  uri: string;
  text: string;
  mimeType?: string;
}

export interface ImageResourceContents {
  uri: string;
  data: string;
  mimeType: string;
}

export interface ListResourcesResult {
  resources: any[];
}

export interface ListPromptsResult {
  prompts: any[];
}

export interface GetPromptResult {
  messages: any[];
}

export interface ReadResourceResult {
  contents: any[];
}

export interface Prompt {
  name: string;
  description?: string;
  arguments?: any[];
}

export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface Tool {
  name: string;
  description?: string;
  inputSchema: any;
}