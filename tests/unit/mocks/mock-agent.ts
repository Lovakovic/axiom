import { StreamEvent } from "../../../src/agent/types";

export class MockAgent {
  private responseSequence: StreamEvent[] = [];

  constructor(mockResponseSequence: StreamEvent[] = []) {
    this.responseSequence = mockResponseSequence;
  }

  async *streamResponse(
    input: string,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<StreamEvent> {
    for (const event of this.responseSequence) {
      if (options?.signal?.aborted) {
        break;
      }

      // Add a small delay to simulate streaming
      await new Promise(resolve => setTimeout(resolve, 10));
      yield event;
    }
  }
}

export class MockAgentManager {
  private agents: { [key: string]: any } = {};
  private activeAgentKey: string = "anthropic";

  constructor(mockAgents: { [key: string]: any } = {}) {
    this.agents = mockAgents;
  }

  async init() {
    return Promise.resolve();
  }

  get activeAgent() {
    return this.agents[this.activeAgentKey];
  }

  switchAgent(newAgentKey: string) {
    if (this.agents[newAgentKey]) {
      this.activeAgentKey = newAgentKey;
      return `Switched active model to ${newAgentKey}.`;
    } else {
      return `Agent "${newAgentKey}" does not exist. Available agents: ${Object.keys(this.agents).join(", ")}.`;
    }
  }

  get currentAgentKey() {
    return this.activeAgentKey;
  }
}
