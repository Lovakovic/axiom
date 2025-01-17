import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ChatAnthropic } from "@langchain/anthropic";
import { StateGraph, MemorySaver, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { MCPClient } from "./client.js";
import { DynamicStructuredTool } from "@langchain/core/tools";

// Define the state type for our graph
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
  }),
});

export class Agent {
  private app: any;
  private mcpClient: MCPClient;

  constructor(apiKey: string) {
    this.mcpClient = new MCPClient();
    this.setupAgent(apiKey);
  }

  private async setupAgent(apiKey: string) {
    // Connect to MCP server
    await this.mcpClient.connect("node", ["dist/server/index.js"]);
    const tools = await this.mcpClient.getTools();

    // Create tool wrappers for MCP tools
    const wrappedTools = tools.map((mcpTool) => (new DynamicStructuredTool({
      name: mcpTool.name,
      description: mcpTool.description ?? "",
      func: async (args: Record<string, unknown>) => {
        const result = await this.mcpClient.executeTool(mcpTool.name, args);
        return result.content[0].text;
      },
      schema: mcpTool.inputSchema,
    })));

    // Create the model
    const model = new ChatAnthropic({
      apiKey,
      model: "claude-3-sonnet-20240229",
      temperature: 0,
    }).bindTools(wrappedTools);

    // Create our tool node
    const toolNode = new ToolNode(wrappedTools);

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
      const response = await model.invoke(messages);
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

  async process(input: string, threadId: string = "default") {
    const state = await this.app.invoke(
      {
        messages: [new HumanMessage(input)]
      },
      {
        configurable: { thread_id: threadId }
      }
    );

    const lastMessage = state.messages[state.messages.length - 1];
    return lastMessage.content;
  }
}