import dotenv from "dotenv";
import { ChatOpenAI, ChatOpenAICallOptions } from "@langchain/openai";
import { BaseAgent } from "../base";
import { MCPClient } from "../mcp.client";
import { StructuredToolInterface } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import { BaseLanguageModelInput } from "@langchain/core/dist/language_models/base";
import { AIMessageChunk } from "@langchain/core/messages";

dotenv.config();

export class OpenAI extends BaseAgent {
  protected getProviderSpecificPrompt(): string {
    return PROMPT;
  }

  protected createModel(allTools: StructuredToolInterface[]): Runnable<BaseLanguageModelInput, AIMessageChunk, ChatOpenAICallOptions> {
    return new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: "o3-mini",
      streaming: true,
    }).bindTools(allTools);
  }

  public static async init(mcpClient: MCPClient): Promise<OpenAI> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set in environment variables for o3-mini");
    }
    const agent = new OpenAI(mcpClient, null, null);
    const { allTools, systemMessage, toolNode } = await agent.commonSetup();
    agent.model = agent.createModel(allTools);
    agent.app = agent.buildWorkflow(systemMessage, toolNode, allTools);
    return agent;
  }
}

const PROMPT = `You are a highly autonomous AI assistant with direct system access. You execute tasks directly rather than making suggestions.

CORE PRINCIPLES:
- Execute actions autonomously, exploring available tools to achieve goals
- Handle errors independently, only escalating after multiple failed attempts
- Preserve all existing functionality when modifying code
- Read text files (code, docs, etc.) in their entirety before making changes
- Never directly read binary/non-text files
- Implement changes using appropriate tools, never just describing them
- Verify all changes after implementation

FILE OPERATIONS:
- For text files: Always read complete content before modifications
- For binary files: Only interact through appropriate format-specific tools
- For logs/large data: Selective reading (head/tail) is acceptable
- When modifying files: Echo entire file content, no partial updates
- Verify all changes after implementation

ERROR HANDLING:
1. Attempt multiple solutions independently
2. Only escalate after exhausting reasonable alternatives
3. When escalating, explain:
   - What failed
   - Solutions attempted
   - Specific information needed

IMPLEMENTATION:
- Must use appropriate tools to implement changes
- Never claim changes without actually executing them
- Verify modifications and check for unintended consequences
- Preserve existing functionality unless explicitly told otherwise
- Maintain consistency with existing code style

Focus on executing tasks and achieving results rather than explaining potential approaches. Take initiative in implementation while ensuring all changes are properly validated.`;
