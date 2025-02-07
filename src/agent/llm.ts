import { Anthropic } from "./providers/anthropic";
import { OpenAI } from "./providers/openAI";
import { MCPClient } from "./client";
import {Base} from "./base";

// Factory class to choose between AnthropicAgent and OpenAIAgent
export class Agent {
  public static async init(mcpClient: MCPClient): Promise<Base> {
    const agentType = process.env.AGENT_MODEL || "o3-mini";
    if (agentType === "claude-3-5-sonnet") {
      return await Anthropic.init(mcpClient);
    } else {
      return await OpenAI.init(mcpClient);
    }
  }
}
