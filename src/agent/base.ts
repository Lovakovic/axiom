import dotenv from "dotenv";
import os from "os";
import {AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage} from "@langchain/core/messages";
import {DynamicStructuredTool, StructuredToolInterface} from "@langchain/core/tools";
import {convertJSONSchemaDraft7ToZod} from "../shared/util/draftToZod";
import {MCPClient} from "./mcp.client";
import {ToolNode} from "./util/tool-node";
import {Annotation, messagesStateReducer, StateGraph} from "@langchain/langgraph";
import {createViewImageTool} from "./local_tools/image.tool";
import {MessageEvent, StreamEvent, TextStreamEvent, ToolEvent, ToolInputEvent, ToolStartEvent} from "./types";
import {SystemMessagePromptTemplate} from "@langchain/core/prompts";
import {MessageContentText} from "@langchain/core/dist/messages/base";
import {ConversationState} from "./state/conversation.state";
import {BaseChatModel} from "@langchain/core/dist/language_models/chat_models";

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
  protected abstract createModel(allTools: StructuredToolInterface[]): BaseChatModel;

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
  protected buildWorkflow(systemMessage: SystemMessage, toolNode: ToolNode, allTools: any[]): any {
    const callModel = async (state: typeof StateAnnotation.State) => {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as BaseMessage | undefined;

      if (lastMessage?.getType() === "ai" && ((lastMessage as AIMessage)?.tool_calls?.length ?? 0) > 0) {
        (lastMessage as any).tool_calls = [];
      }

      const filteredMessages = messages.filter((message) => {
        return typeof message.content === "string" || message.content.length > 0;
      });

      // console.log('Calling model with messages', filteredMessages);
      const response = await this.model.invoke([systemMessage, ...filteredMessages]);
      ConversationState.getInstance().addMessage(response);
      return { messages: [response] };
    };

    const callTools = async (state: typeof StateAnnotation.State) => {
      const results = await toolNode.invoke(state);
      ConversationState.getInstance().addMessages(results.messages);
      return { messages: results.messages };
    }

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
      .addNode("tools", callTools)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue)
      .addEdge("tools", "agent");

    return workflow.compile();
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
      default_editor: (process.env.EDITOR ?? process.env.VISUAL) ?? "Unknown",
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
    options?: { signal?: AbortSignal; previousBuffer?: { role: "human" | "ai"; text: string }[] }
  ): AsyncGenerator<StreamEvent> {
    const convState = ConversationState.getInstance();

    // First get the messages from the conversation state - this will finalize buffers
    const messages = convState.getMessages();

    // Then add the human input as a complete message.
    convState.addMessage(new HumanMessage({ content: input }));

    let currentToolId = "";

    for await (const event of this.app.streamEvents(
      { messages },
      {
        version: "v2",
        recursionLimit: 100,
        signal: options?.signal,
      }
    )) {
      if (event.event === 'on_chat_model_end') {
        convState.clearBuffers();
        const message = event.data.output as AIMessageChunk;

        if(Array.isArray(message.content) && message.content.some(isAnthropicTextContent)) {
          const texts = message.content
            .map((content) => isAnthropicTextContent(content)
              ? { type: 'text' as const, content: content.text }
              : null)
            .filter((item): item is { type: 'text', content: string } => item !== null);

          if (texts.length > 0) {
            yield* texts as MessageEvent[]; // Should only be one, but just in case
          }
        }

        if(typeof  message.content === 'string' && message.content.trim().length > 0) {
          yield { type: 'text', content: message.content } as MessageEvent;
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            yield { type: 'tool_call', tool: { ...toolCall, id: toolCall.id ?? 'unknown-tool-id'} } as ToolEvent;
          }
        }
      }

      if (event.event !== 'on_chat_model_stream') continue;
      const chunk = event.data.chunk as AIMessageChunk;

      if (chunk.content && Array.isArray(chunk.content)) {
        for (const contentItem of chunk.content) {
          if (contentItem.type === 'text_delta' && contentItem.text) {
            convState.addTextDelta(contentItem.text);
            yield { type: 'text_delta', content: contentItem.text } as TextStreamEvent;
          }
        }
      }
      if (chunk.content && typeof chunk.content === 'string') {
        convState.addTextDelta(chunk.content);
        yield { type: 'text_delta', content: chunk.content } as TextStreamEvent;
      }
      if (chunk.tool_calls && Array.isArray(chunk.tool_calls)) {
        for (const toolCall of chunk.tool_calls) {
          const toolId = toolCall.id ?? 'unknown-tool-id';
          currentToolId = toolId;
          convState.addToolCallDelta(toolCall.name + ': ');
          yield { type: 'tool_start', tool: { name: toolCall.name, id: toolId } } as ToolStartEvent;
        }
      }
      if (chunk.tool_call_chunks && Array.isArray(chunk.tool_call_chunks)) {
        for (const toolCallChunk of chunk.tool_call_chunks) {
          if (toolCallChunk.args && currentToolId) {
            convState.addToolCallDelta(toolCallChunk.args);
            yield { type: 'tool_input_delta', content: toolCallChunk.args, toolId: currentToolId } as ToolInputEvent;
          }
        }
      }
    }
  }
}

const isAnthropicTextContent = (content: any): content is MessageContentText => {
  return typeof content === "object" && content.type === "text";
}
