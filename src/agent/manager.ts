"use strict";

import { OpenAI } from "./providers/openai";
import { Anthropic } from "./providers/anthropic";
import { MCPClient } from "./mcp.client";

export class AgentManager {
  private agents: { [key: string]: any } = {};
  private activeAgentKey: string = "anthropic";

  // Initialize both agent providers
  async init(mcpClient: MCPClient): Promise<void> {
    this.agents["openai"] = await OpenAI.init(mcpClient);
    this.agents["anthropic"] = await Anthropic.init(mcpClient);
  }

  // Return the currently active agent
  get activeAgent(): any {
    return this.agents[this.activeAgentKey];
  }

  // Switch to the provided agent key if available
  switchAgent(newAgentKey: string): string {
    if (this.agents[newAgentKey]) {
      this.activeAgentKey = newAgentKey;
      return `Switched active model to ${newAgentKey}.`;
    } else {
      return `Agent "${newAgentKey}" does not exist. Available agents: ${Object.keys(this.agents).join(", ")}.`;
    }
  }
  public get currentAgentKey(): string {
    return this.activeAgentKey;
  }
}
