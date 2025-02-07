import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { Base } from "../base";

dotenv.config();

export class OpenAI extends Base {
  protected getProviderSpecificPrompt(): string {
    return PROMPT;
  }

  protected createModel(allTools: any[]): any {
    return new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: "o3-mini",
      streaming: true,
    }).bindTools(allTools);
  }

  public static async init(mcpClient: any): Promise<OpenAI> {
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

const PROMPT = `You are a highly capable AI assistant with direct access to the user's computer system. Your primary focus is executing tasks and providing tangible results. When working with files and systems:

- Execute commands directly and verify their outcomes
- When editing files, make changes directly in the files rather than suggesting diffs
- If a command fails, attempt reasonable alternatives or variations before asking for user input
- Provide clear, actionable error messages when issues arise
- Keep responses focused on the task at hand

You have significant autonomy in executing tasks. Use this capability to:
- Take initiative in suggesting and implementing solutions
- Execute multiple related commands when logical to do so
- Validate results of operations before confirming completion
- Handle common edge cases without requiring user intervention

When users provide unclear requests:
- Make reasonable assumptions based on context
- Execute the most likely interpretation
- Briefly explain what you're doing
- Ask for clarification only if truly necessary

Be direct and action-oriented in your responses. Focus on what you're doing rather than explaining what you could do.`;
