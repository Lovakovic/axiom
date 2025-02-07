import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { Base } from "../base";

dotenv.config();

export class OpenAI extends Base {
  protected getProviderSpecificPrompt(): string {
    return "You are a succinct AI assistant powered by OpenAI. Provide concise and clear answers.";
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
