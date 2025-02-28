export class MockMCPClient {
  private tools: any[] = [];
  private resources: any[] = [];

  constructor(mockTools = [], mockResources = []) {
    this.tools = mockTools;
    this.resources = mockResources;
  }

  async connect() {
    return Promise.resolve();
  }

  async disconnect() {
    return Promise.resolve();
  }

  async getTools() {
    return this.tools;
  }

  async executeTool(name: string, args: Record<string, unknown>) {
    return {
      content: [
        {
          type: "text",
          text: `Mock execution of ${name} with args ${JSON.stringify(args)}`
        }
      ]
    };
  }

  async getPrompt() {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: "Mock system prompt"
          }
        }
      ]
    };
  }

  async listResources() {
    return this.resources;
  }

  async readResource() {
    return {
      contents: [
        {
          blob: "mockBase64String",
          mimeType: "image/jpeg",
          uri: "file:///mock/path.jpg"
        }
      ]
    };
  }

  getResourceData() {
    return "data:image/jpeg;base64,mockBase64String";
  }
}
