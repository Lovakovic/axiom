import dotenv from "dotenv";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { BaseAgent } from "../base";
import { MCPClient } from "../mcp.client";
import { StructuredToolInterface } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import { BaseLanguageModelInput } from "@langchain/core/dist/language_models/base";
import { AIMessageChunk } from "@langchain/core/messages";

dotenv.config(); // Ensures .env (and GOOGLE_APPLICATION_CREDENTIALS if set there) is loaded

export class VertexAI extends BaseAgent {
  protected getProviderSpecificPrompt(): string {
    // Using a prompt similar to Anthropic's for safety and succinctness with Gemini.
    return GEMINI_SYSTEM_PROMPT;
  }

  protected createModel(allTools: StructuredToolInterface[]): Runnable<BaseLanguageModelInput, AIMessageChunk> {
    return new ChatVertexAI({
      model: "gemini-2.5-pro-preview-05-06",
      temperature: 0,
      streaming: true,
      maxRetries: 2,   // Sensible default from LangChain examples
      // Location might be needed for specific models/features, but gemini-2.5-pro-preview is often global.
      // The SDK handles authentication via GOOGLE_APPLICATION_CREDENTIALS env var.
    }).bindTools(allTools);
  }

  public static async init(mcpClient: MCPClient): Promise<VertexAI> {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.warn(
        "WARNING: GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. " +
        "ChatVertexAI might not authenticate correctly. Ensure it's set to the path of your service account key file (e.g., './gc_key.json')."
      );
      // Note: The SDK might still attempt other auth methods (e.g., gcloud default).
    }

    const agent = new VertexAI(mcpClient, null, null);
    const { allTools, systemMessage, toolNode } = await agent.commonSetup();
    agent.model = agent.createModel(allTools);
    agent.app = agent.buildWorkflow(systemMessage, toolNode, allTools);
    return agent;
  }
}

// A system prompt tailored for Gemini, emphasizing safety and clarity.
const GEMINI_SYSTEM_PROMPT = `You are a succinct AI assistant. Brief, precise, and to the point.
    
IMPORTANT SAFETY GUIDELINES:
1. You have REAL access to the user's computer through shell commands.
2. Always be careful with system-modifying commands.
3. Ask for confirmation before executing potentially dangerous operations.
4. Never execute commands that could:
   - Delete important files or directories
   - Modify system settings without explicit permission
   - Consume excessive system resources

Please help the user while keeping their system safe.`;