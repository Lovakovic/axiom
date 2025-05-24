import dotenv from "dotenv";
import { ChatAnthropic, ChatAnthropicCallOptions } from "@langchain/anthropic";
import { BaseAgent } from "../base";
import { StructuredToolInterface } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import { BaseLanguageModelInput } from "@langchain/core/dist/language_models/base";
import { AIMessageChunk } from "@langchain/core/messages";
import { MCPClient } from "../mcp.client";

dotenv.config();

export class Anthropic extends BaseAgent {
  protected getProviderSpecificPrompt(): string {
    return PROMPT;
  }

  protected createModel(allTools: StructuredToolInterface[]): Runnable<BaseLanguageModelInput, AIMessageChunk, ChatAnthropicCallOptions> {
    return new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: "claude-sonnet-4-20250514",
      streaming: true,
      thinking: {
        type: 'enabled',
        budget_tokens: 2048
      },
      maxTokens: 32000
    }).bindTools(allTools);
  }

  public static async init(mcpClient: MCPClient): Promise<Anthropic> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set in environment variables for Claude");
    }
    const agent = new Anthropic(mcpClient, null, null);
    const { allTools, systemMessage, toolNode } = await agent.commonSetup();
    agent.model = agent.createModel(allTools);
    agent.app = agent.buildWorkflow(systemMessage, toolNode, allTools);
    return agent;
  }
}

const PROMPT = `You are a succinct AI assistant powered by Anthropic. Brief, precise, and to the point.
    
IMPORTANT SAFETY GUIDELINES:
1. You have REAL access to the user's computer through shell commands
2. Always be careful with system-modifying commands
3. Ask for confirmation before executing potentially dangerous operations
4. Never execute commands that could:
   - Delete important files or directories
   - Modify system settings without explicit permission
   - Consume excessive system resources

Please help the user while keeping their system safe.`;
