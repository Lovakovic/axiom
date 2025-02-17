import dotenv from "dotenv";
import os from "os";
import {AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage} from "@langchain/core/messages";
import {DynamicStructuredTool} from "@langchain/core/tools";
import {convertJSONSchemaDraft7ToZod} from "../shared/util/draftToZod";
import {MCPClient} from "./client";
import {ToolNode} from "./util/tool-node";
import {Annotation, MemorySaver, messagesStateReducer, StateGraph} from "@langchain/langgraph";
import {createViewImageTool} from "./local_tools/image_tool";
import {StreamEvent} from "./types";
import {SystemMessagePromptTemplate} from "@langchain/core/prompts";
import { StreamLogger } from "../stream-logger";
import { MessageContentText } from "@langchain/core/dist/messages/base";

dotenv.config();

export const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
  }),
});

export abstract class BaseAgent {
  protected mcpClient: MCPClient;
  protected app: any;
  protected model: any;

  constructor(mcpClient: MCPClient, app: any, model: any) {
    this.mcpClient = mcpClient;
    this.app = app;
    this.model = model;
  }

  // Subclasses must implement these methods to provide a unique system message and model configuration.
  protected abstract createModel(allTools: any[]): any;

  // Common setup: get MCP tools, wrap them, create local tools, combine and form a tool node.
  protected async commonSetup(): Promise<{ allTools: any[]; systemMessage: SystemMessage; toolNode: any }> {
    const tools = await this.mcpClient.getTools();

    const wrappedMCPTools = tools.map((mcpTool) => {
      return new DynamicStructuredTool({
        name: mcpTool.name,
        description: mcpTool.description ?? "",
        func: async (args: Record<string, unknown>) => {
          try {
            const result = await this.mcpClient.executeTool(mcpTool.name, args);
            return result.content[0].text;
          } catch (error) {
            if (error instanceof Error && error.message?.includes("Connection closed")) {
              return "Tool execution was interrupted.";
            }
            throw error;
          }
        },
        schema: convertJSONSchemaDraft7ToZod(JSON.stringify(mcpTool.inputSchema)),
      });
    });

    const viewImage = createViewImageTool(this.mcpClient);
    const allTools = [...wrappedMCPTools, viewImage];

    const systemMessage = await this.getSystemMessage(this.mcpClient);

    const toolNode = await ToolNode.create(allTools, { handleToolErrors: true });

    return { allTools, systemMessage, toolNode };
  }

  // Build the workflow (state graph) using common logic.
  protected buildWorkflow(systemMessage: SystemMessage, toolNode: any, allTools: any[]): any {
    const callModel = async (state: typeof StateAnnotation.State) => {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as BaseMessage | undefined;

      if (lastMessage?.getType() === "ai" && ((lastMessage as any)?.tool_calls?.length ?? 0) > 0) {
        (lastMessage as any).tool_calls = [];
      }

      const filteredMessages = messages.filter((message) => {
        return typeof message.content === "string" || message.content.length > 0;
      });

      const response = await this.model.invoke([systemMessage, ...filteredMessages]);
      return { messages: [response] };
    };

    const shouldContinue = (state: typeof StateAnnotation.State) => {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as any;
      if (lastMessage.tool_calls?.length) {
        return "tools";
      }
      return "__end__";
    };

    const workflow = new StateGraph(StateAnnotation)
      .addNode("agent", callModel)
      .addNode("tools", toolNode.invoke)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue)
      .addEdge("tools", "agent");

    const checkpointer = new MemorySaver();
    return workflow.compile({checkpointer});
  }

  protected async getBasePromptData(mcpClient: MCPClient): Promise<Record<string, string>> {
    const checkCommand = async (cmd: string): Promise<boolean> => {
      try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        await execAsync(`which ${cmd}`);
        return true;
      } catch {
        return false;
      }
    };

    return {
      user: os.userInfo().username,
      OS: `${os.type()} ${os.release()}`,
      shell_type: process.env.SHELL ?? "Unknown",
      date_time: new Date().toISOString(),
      architecture: os.arch(),
      default_editor: process.env.EDITOR || process.env.VISUAL || "Unknown",
      current_dir: process.cwd(),
      has_tree: (await checkCommand("tree")).toString(),
      has_git: (await checkCommand("git")).toString(),
      has_jq: (await checkCommand("jq")).toString(),
      has_curl: (await checkCommand("curl")).toString(),
      has_wget: (await checkCommand("wget")).toString(),
    };
  }

  protected abstract getProviderSpecificPrompt(): string;

  protected async getSystemMessage(mcpClient: MCPClient): Promise<SystemMessage> {
    try {
      const promptData = await this.getBasePromptData(mcpClient);
      const promptResult = await mcpClient.getPrompt("shell-system", promptData);

      const baseSystemMessage = SystemMessagePromptTemplate.fromTemplate(
        `${this.getProviderSpecificPrompt()}\n\n{serverInstructions}`
      );

      return await baseSystemMessage.format({
        serverInstructions: promptResult.messages[0].content.text,
      });
    } catch (error) {
      console.error("Failed to get system prompt:", error);
      return new SystemMessage(this.getProviderSpecificPrompt());
    }
  }


  // StreamResponse implementation common to both agents.
  public async *streamResponse(
    input: string,
    threadId: string,
    options?: { signal?: AbortSignal; previousBuffer?: { role: "human" | "ai"; text: string }[] }
  ): AsyncGenerator<StreamEvent> {
    let currentToolId = "";
    const messages = options?.previousBuffer
      ? options.previousBuffer.map((message) =>
        message.role === "ai" ? new AIMessage(message.text) : new HumanMessage(message.text)
      )
      : [new HumanMessage(input)];

    for await (const event of this.app.streamEvents(
      { messages },
      {
        configurable: { thread_id: threadId },
        version: "v2",
        recursionLimit: 75,
        signal: options?.signal,
      }
    )) {
      if (event.event === 'on_chat_model_end') {
        const message = event.data.output as AIMessageChunk;

        if(Array.isArray(message.content) && message.content.some(isAnthropicTextContent)) {
          const texts = message.content
            .map((content) => isAnthropicTextContent(content)
              ? { type: 'text' as const, content: content.text }
              : null)
            .filter((item): item is { type: 'text', content: string } => item !== null);

          if (texts.length > 0) {
            yield* texts; // Should only be one, but just in case
          }
        }

        if(typeof  message.content === 'string' && message.content.trim().length > 0) {
          yield { type: 'text', content: message.content };
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            yield { type: 'tool_call', tool: { ...toolCall, id: toolCall.id ?? 'unknown-tool-id'} };
          }
        }
      }

      if (event.event !== 'on_chat_model_stream') continue;
      const chunk = event.data.chunk as AIMessageChunk;

      if (chunk.content && Array.isArray(chunk.content)) {
        for (const contentItem of chunk.content) {
          if (contentItem.type === 'text_delta' && contentItem.text) {
            yield { type: 'text_delta', content: contentItem.text };
          }
        }
      }
      if (chunk.content && typeof chunk.content === 'string') {
        yield { type: 'text_delta', content: chunk.content };
      }
      if (chunk.tool_calls && Array.isArray(chunk.tool_calls)) {
        for (const toolCall of chunk.tool_calls) {
          const toolId = toolCall.id ?? 'unknown-tool-id';
          currentToolId = toolId;
          yield { type: 'tool_start', tool: { name: toolCall.name, id: toolId } };
        }
      }
      if (chunk.tool_call_chunks && Array.isArray(chunk.tool_call_chunks)) {
        for (const toolCallChunk of chunk.tool_call_chunks) {
          if (toolCallChunk.args && currentToolId) {
            yield { type: 'tool_input_delta', content: toolCallChunk.args, toolId: currentToolId };
          }
        }
      }
    }
  }
}

const isAnthropicTextContent = (content: any): content is MessageContentText => {
  return typeof content === "object" && content.type === "text";
}
