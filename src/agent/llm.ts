import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { ChatAnthropic } from "@langchain/anthropic";
import { Annotation, MemorySaver, messagesStateReducer, StateGraph } from "@langchain/langgraph";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { convertJSONSchemaDraft7ToZod } from "../shared/util/draftToZod";
import { MCPClient } from "./client";
import { ToolNode } from "./util/tool-node";
import { createViewImageTool } from "./local_tools/image_tool";
import os from 'os';
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Define the state type for our graph
export const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
  }),
});

export class Agent {
  private readonly app: any;
  private readonly mcpClient: MCPClient;

  private constructor(mcpClient: MCPClient, app: any) {
    this.mcpClient = mcpClient;
    this.app = app;
  }

  static async init(): Promise<Agent> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set in environment variables");
    }

    const mcpClient = new MCPClient();
    await mcpClient.connect("node", ["dist/server/index.js"]);

    // Get MCP tools
    const tools = await mcpClient.getTools();

    // Create tool wrappers for MCP tools
    const wrappedMCPTools = tools.map((mcpTool) => {
      return new DynamicStructuredTool({
        name: mcpTool.name,
        description: mcpTool.description ?? "",
        func: async (args: Record<string, unknown>) => {
          const result = await mcpClient.executeTool(mcpTool.name, args);
          return result.content[0].text;
        },
        schema: convertJSONSchemaDraft7ToZod(JSON.stringify(mcpTool.inputSchema)),
      });
    });

    // Create local tools
    const viewImage = createViewImageTool(mcpClient);

    // Combine all tools
    const allTools = [...wrappedMCPTools, viewImage];

    // Get system prompt and create combined message
    const systemMessage = await Agent.getSystemMessage(mcpClient);

    // Create the model with streaming enabled
    const model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: "claude-3-5-sonnet-20241022",
      temperature: 0,
      streaming: true,
    }).bindTools(allTools);

    // Create our tool node
    const toolNode = ToolNode.create(allTools, { handleToolErrors: true });

    // Define continue condition
    const shouldContinue = (state: typeof StateAnnotation.State) => {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as AIMessage;

      if (lastMessage.tool_calls?.length) {
        return "tools";
      }
      return "__end__";
    };

    // Define model call function with system message
    const callModel = async (state: typeof StateAnnotation.State) => {
      const messages = state.messages;
      const response = await model.invoke([systemMessage, ...messages]);
      return { messages: [response] };
    };

    // Create and compile the graph
    const workflow = new StateGraph(StateAnnotation)
      .addNode("agent", callModel)
      .addNode("tools", toolNode.invoke)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue)
      .addEdge("tools", "agent");

    // Initialize memory
    const checkpointer = new MemorySaver();

    // Compile the graph
    const app = workflow.compile({ checkpointer });

    return new Agent(mcpClient, app);
  }

  private static async getSystemMessage(mcpClient: MCPClient): Promise<SystemMessage> {
    try {
      // Get the system prompt from the server with current system info
      const promptResult = await mcpClient.getPrompt("shell-system", {
        user: os.userInfo().username,
        OS: `${os.type()} ${os.release()}`,
        shell_type: process.env.SHELL ?? "Unknown",
        date_time: new Date().toISOString(),
      });

      // Create a template that combines base message and server instructions
      const baseSystemMessage = SystemMessagePromptTemplate.fromTemplate(
        "You are a helpful AI assistant. You're brief, concise and up to the point, unless asked otherwise.\n\n{serverInstructions}"
      );

      // Format the template with the server's instructions
      return await baseSystemMessage.format({
        serverInstructions: promptResult.messages[0].content.text,
      });
    } catch (error) {
      console.error("Failed to get system prompt:", error);
      // Fallback to basic system message if server prompt fails
      return new SystemMessage(
        "You are a helpful AI assistant. You're brief, concise and up to the point, unless asked otherwise."
      );
    }
  }

  async* streamResponse(input: string, threadId: string = "default") {
    // Stream events from the application
    for await (const event of this.app.streamEvents(
      {
        messages: [new HumanMessage(input)],
      },
      {
        configurable: { thread_id: threadId },
        version: "v1",
      }
    )) {
      // Handle LLM streaming events
      if (event.event === "on_llm_stream") {
        const chunk = event.data.chunk;
        if (chunk.text) {
          yield chunk.text;
        }
      }
    }
  }
}