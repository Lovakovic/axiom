"use strict";

import { OpenAI } from "./providers/openai";
import { Anthropic } from "./providers/anthropic";
import { VertexAI } from "./providers/vertexai";
import { MCPClient } from "./mcp.client";
import { Logger } from "../logger";

export class AgentManager {
  private agents: { [key: string]: any } = {};
  private potentialAgents: string[] = ["openai", "claude", "gemini"]; // All known agent keys
  private activeAgentKey: string = ""; // Initialize as empty, will be set in init
  private logger: Logger;

  constructor() {
    // Logger.getInstance() should work if Logger.init() was called and completed before new AgentManager()
    this.logger = Logger.getInstance();
  }

  // Initialize both agent providers
  async init(mcpClient: MCPClient): Promise<void> {
    await this.logger.info('AGENT_MANAGER', 'Initializing agents...');

    const initializers: { key: string, initFunc: () => Promise<any>, prerequisiteEnvVarName: string }[] = [
      {
        key: "openai",
        initFunc: () => OpenAI.init(mcpClient),
        prerequisiteEnvVarName: "OPENAI_API_KEY"
      },
      {
        key: "claude",
        initFunc: () => Anthropic.init(mcpClient),
        prerequisiteEnvVarName: "ANTHROPIC_API_KEY"
      },
      {
        key: "gemini",
        initFunc: () => VertexAI.init(mcpClient),
        prerequisiteEnvVarName: "GOOGLE_APPLICATION_CREDENTIALS"
      }
    ];

    for (const agentInitializer of initializers) {
      try {
        // Provider's init method is expected to check its own prerequisites (e.g., API keys)
        // and throw if they are not met.
        this.agents[agentInitializer.key] = await agentInitializer.initFunc();
        await this.logger.info('AGENT_MANAGER', `${agentInitializer.key} agent initialized successfully.`);
      } catch (error) {
        await this.logger.warn('AGENT_MANAGER', `Failed to initialize ${agentInitializer.key} agent (is ${agentInitializer.prerequisiteEnvVarName} set?): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Set default active agent based on preference and availability
    const preferredOrder = ["gemini", "claude", "openai"];
    for (const key of preferredOrder) {
      if (this.agents[key]) {
        this.activeAgentKey = key;
        await this.logger.info('AGENT_MANAGER', `Default active agent set to: ${key}`);
        break;
      }
    }

    if (!this.activeAgentKey && Object.keys(this.agents).length > 0) {
      // Fallback to the first available agent if preferred ones are not configured
      this.activeAgentKey = Object.keys(this.agents)[0];
      await this.logger.info('AGENT_MANAGER', `Preferred agents not configured. Default active agent set to first available: ${this.activeAgentKey}`);
    } else if (Object.keys(this.agents).length === 0) {
      await this.logger.error('AGENT_MANAGER', 'CRITICAL: No AI agents could be initialized. The application will not function as expected. Please check your API key configurations (e.g., OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_APPLICATION_CREDENTIALS).');
      // activeAgentKey remains ""
    }
  }

  // Return the currently active agent
  get activeAgent(): any {
    if (!this.activeAgentKey || !this.agents[this.activeAgentKey]) {
      this.logger.error('AGENT_MANAGER', 'Attempted to access active agent, but no agent is active or configured.');
      return null;
    }
    return this.agents[this.activeAgentKey];
  }

  // Switch to the provided agent key if available
  switchAgent(newAgentKey: string): string {
    const normalizedKey = newAgentKey.toLowerCase();
    if (this.agents[normalizedKey]) {
      this.activeAgentKey = normalizedKey;
      return `Switched active model to ${normalizedKey}.`;
    } else if (this.potentialAgents.includes(normalizedKey)) {
      // Agent is known but not configured/initialized
      const requiredConfig = normalizedKey === 'openai' ? 'OPENAI_API_KEY' :
        normalizedKey === 'claude' ? 'ANTHROPIC_API_KEY' :
          normalizedKey === 'gemini' ? 'GOOGLE_APPLICATION_CREDENTIALS' :
            'the relevant API key/credentials';
      return `Agent "${normalizedKey}" is not configured. Please ensure ${requiredConfig} is set. \nAvailable configured agents: ${this.getAvailableAgentKeys().join(", ") || "None"}.`;
    } else {
      return `Agent "${normalizedKey}" is not a recognized agent type. \nKnown agent types (may require configuration): ${this.potentialAgents.join(", ")}. \nCurrently configured agents: ${this.getAvailableAgentKeys().join(", ") || "None"}.`;
    }
  }
  public get currentAgentKey(): string {
    return this.activeAgentKey;
  }

  public getAvailableAgentKeys(): string[] {
    return Object.keys(this.agents);
  }
}