import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { StateGraph, MemorySaver, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { MCPClient } from "./client.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { convertJSONSchemaDraft7ToZod } from "../shared/util/draftToZod";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const SYSTEM_MESSAGE = `You're a conversational and helpful AI agent with access to various tools. 
You help user do whatever is requested. You don't bore users with "I'm an AI" type of messages. 
You're here to help with the tools you have at a disposal. You're brief, concise and up to the point, unless asked otherwise.`;

// Define the state type for our graph
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
  }),
});

export class Agent {
  private app: any;
  private readonly mcpClient: MCPClient;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set in environment variables");
    }
    this.mcpClient = new MCPClient();
    this.setupAgent();
  }

  private async setupAgent() {
    // Connect to MCP server
    await this.mcpClient.connect("node", ["dist/server/index.js"]);
    const tools = await this.mcpClient.getTools();

    // Create tool wrappers for MCP tools
    const wrappedTools = tools.map((mcpTool) => {
      return new DynamicStructuredTool({
        name: mcpTool.name,
        description: mcpTool.description ?? "",
        func: async (args: Record<string, unknown>) => {
          const result = await this.mcpClient.executeTool(mcpTool.name, args);
          return result.content[0].text;
        },
        schema: convertJSONSchemaDraft7ToZod(JSON.stringify(mcpTool.inputSchema)),
      })
    });

    // Create the model with streaming enabled
    const model = new ChatAnthropic({
      apiKey: process.env.OPENAI_API_KEY,
      model: "claude-3-5-sonnet-20241022",
      temperature: 0,
      streaming: true
    }).bindTools(wrappedTools);

    // Create our tool node
    const toolNode = new ToolNode(wrappedTools, { handleToolErrors: true });

    // Define continue condition
    const shouldContinue = (state: typeof StateAnnotation.State) => {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as AIMessage;

      if (lastMessage.tool_calls?.length) {
        return "tools";
      }
      return "__end__";
    };

    // Define model call function
    const callModel = async (state: typeof StateAnnotation.State) => {
      const messages = state.messages;
      const response = await model.invoke([new SystemMessage(SYSTEM_MESSAGE), ...messages]);
      return { messages: [response] };
    };

    // Create and compile the graph
    const workflow = new StateGraph(StateAnnotation)
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue)
      .addEdge("tools", "agent");

    // Initialize memory
    const checkpointer = new MemorySaver();

    // Compile the graph
    this.app = workflow.compile({ checkpointer });
  }

  async* streamResponse(input: string, threadId: string = "default") {
    // Stream events from the application
    for await (const event of this.app.streamEvents(
      {
        messages: [new HumanMessage(input)],
      },
      {
        recursionLimit: 50,
        configurable: { thread_id: threadId },
        version: 'v1'
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
