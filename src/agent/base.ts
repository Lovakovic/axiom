import dotenv from "dotenv";
import os from "os";
import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { MCPClient } from "./mcp.client";
import { ToolNode } from "./util/tool-node";
import { Annotation, messagesStateReducer, StateGraph } from "@langchain/langgraph";
import { MessageEvent, StreamEvent, TextStreamEvent, ToolEvent, ToolInputEvent, ToolStartEvent } from "./types";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { MessageContentText } from "@langchain/core/dist/messages/base";
import { ConversationState } from "./state/conversation.state";
import { Logger } from "../logger";
import { prepareMessagesForProvider } from "./util/content-filter";

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

  protected abstract createModel(allTools: any[]): any;
  
  protected abstract getProviderKey(): string;

  protected async commonSetup(): Promise<{ allTools: any[]; systemMessage: SystemMessage; toolNode: any }> {
    const wrappedMCPTools = await ToolNode.wrapMCPTools(this.mcpClient);
    const allTools = [...wrappedMCPTools];
    const systemMessage = await this.getSystemMessage(this.mcpClient);
    const toolNode = await ToolNode.create(allTools, {handleToolErrors: true});
    return {allTools, systemMessage, toolNode};
  }

  protected buildWorkflow(systemMessage: SystemMessage, toolNode: ToolNode, allTools: any[]): any {
    const callModel = async (state: typeof StateAnnotation.State) => {
      const logger = Logger.getInstance(); // Get logger instance
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as BaseMessage | undefined;

      if (lastMessage?.getType() === "ai" && ((lastMessage as AIMessage)?.tool_calls?.length ?? 0) > 0) {
        const lastAiMessage = lastMessage as AIMessage;
        lastAiMessage.tool_calls = [];
        if (Array.isArray(lastMessage.content)) {
          lastAiMessage.content = lastMessage.content.filter((content) => content.type === "text");
        }
      }

      // First filter out provider-specific content (like Anthropic's thinking content)
      const providerFilteredMessages = prepareMessagesForProvider(messages, this.getProviderKey());
      
      const filteredMessages = providerFilteredMessages.filter(message => {
        if (message.getType() === 'ai' && (message as AIMessage).tool_calls && (message as AIMessage).tool_calls!.length > 0) {
          return true;
        }
        if (typeof message.content === 'string' && message.content.trim().length > 0) {
          return true;
        }
        if (Array.isArray(message.content) && message.content.length > 0) {
          return message.content.some(part =>
            part.type === 'text' ? (part as MessageContentText).text?.trim().length > 0 : true
          );
        }
        return false;
      });

      if (filteredMessages.length === 0 && messages.length > 0) {
        await logger.warn('MODEL_CALL', 'All messages were filtered out before model invocation.', {originalCount: messages.length});
      }

      // Detailed logging before model invocation
      await logger.debug('MODEL_INVOKE_PRE', 'Preparing to invoke model', {
        systemMessageContent: systemMessage.content,
        systemMessageClass: systemMessage.constructor.name,
        systemMessageId: systemMessage.id,
        filteredMessagesCount: filteredMessages.length,
        filteredMessages: filteredMessages.map(m => ({
          className: m.constructor.name,
          content: m.content,
          id: m.id,
          role: (m as any).role, // if available
          type: m.getType()
        }))
      });

      await logger.info('MODEL_INVOKE', 'Invoking model with messages', {
        messages: filteredMessages.map(m => {
          return {
            type: m.getType(),
            content: m.content,
          }
        })
      })
      const response = await this.model.invoke([systemMessage, ...filteredMessages]);
      ConversationState.getInstance().addMessage(response);
      return {messages: [response]};
    };

    const callTools = async (state: typeof StateAnnotation.State) => {
      const results = await toolNode.invoke(state);
      ConversationState.getInstance().addMessages(results.messages);
      return {messages: results.messages};
    }

    const shouldContinue = (state: typeof StateAnnotation.State) => {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as any;
      if (lastMessage.tool_calls?.length) return "tools";
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
        const {exec} = require('child_process');
        const {promisify} = require('util');
        const execAsync = promisify(exec);
        await execAsync(`which ${cmd}`);
        return true;
      } catch {
        return false;
      }
    };
    const getDistroInfo = async (): Promise<string> => {
      try {
        const fs = require('fs').promises;
        const osRelease = await fs.readFile("/etc/os-release", "utf-8");
        const match = osRelease.match(/^PRETTY_NAME="([^"]*)"/m);
        return match ? match[1] : 'Unknown Distro';
      } catch {
        return 'Unknown Distro';
      }
    };
    return {
      user: os.userInfo().username,
      OS: `${os.type()} ${os.release()}`,
      distro: await getDistroInfo(),
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
      return await baseSystemMessage.format({serverInstructions: promptResult.messages[0].content.text});
    } catch (error) {
      console.error("Failed to get system prompt:", error);
      return new SystemMessage(this.getProviderSpecificPrompt());
    }
  }

  public async* streamResponse(
    input: string,
    options?: { signal?: AbortSignal; previousBuffer?: { role: "human" | "ai"; text: string }[] }
  ): AsyncGenerator<StreamEvent> {
    const logger = Logger.getInstance();
    await logger.debug('STREAM', 'Starting streamResponse', {
      inputLength: input.length,
      hasSignal: !!options?.signal,
      signalAborted: options?.signal?.aborted,
    });
    const convState = ConversationState.getInstance();
    convState.addMessage(new HumanMessage({content: input}));
    await logger.debug('STREAM', 'Added human message to conversation state');
    const currentMessages = convState.getMessages();
    await logger.debug('STREAM', 'Retrieved updated conversation messages for graph input', {
      messageCount: currentMessages.length,
      messageTypes: currentMessages.map(m => m.getType()),
      lastMessageContent: currentMessages.length > 0 ? currentMessages[currentMessages.length - 1]?.content : "N/A"
    });

    let currentToolId = "";
    let eventCount = 0;
    let lastEventTime = Date.now();

    try {
      await logger.debug('STREAM', 'Beginning to stream events from graph');
      for await (const event of this.app.streamEvents(
        {messages: currentMessages},
        {version: "v2", recursionLimit: 500, signal: options?.signal}
      )) {
        const now = Date.now();
        eventCount++;
        if (eventCount % 20 === 0 || now - lastEventTime > 2000) {
          await logger.debug('STREAM', 'Stream progress', {
            eventCount,
            timeSinceLastEvent: now - lastEventTime,
            eventType: event.event
          });
        }
        lastEventTime = now;
        if (options?.signal?.aborted) {
          await logger.info('STREAM', 'Stream aborted by signal', {reason: options.signal.reason, eventCount});
          break;
        }

        if (event.event === 'on_chat_model_end') {
          await logger.debug('STREAM', 'Chat model end event', {
            outputType: event.data.output?.constructor?.name,
            hasToolCalls: !!(event.data.output?.tool_calls?.length),
            toolCallCount: event.data.output?.tool_calls?.length || 0
          });
          convState.clearBuffers();
          const message = event.data.output as AIMessageChunk;
          if (Array.isArray(message.content) && message.content.some(isAnthropicTextContent)) {
            const texts = message.content
              .map((content) => isAnthropicTextContent(content) ? {type: 'text' as const, content: content.text} : null)
              .filter((item): item is { type: 'text', content: string } => item !== null);
            if (texts.length > 0) {
              await logger.debug('STREAM', 'Yielding text content from model_end', {textCount: texts.length});
              yield* texts as MessageEvent[];
            }
          }
          if (typeof message.content === 'string' && message.content.trim().length > 0) {
            await logger.debug('STREAM', 'Yielding string content from model_end', {contentLength: message.content.length});
            yield {type: 'text', content: message.content} as MessageEvent;
          }
          if (message.tool_calls && message.tool_calls.length > 0) {
            await logger.debug('STREAM', 'Processing tool calls from model_end', {toolCallCount: message.tool_calls.length});
            for (const toolCall of message.tool_calls) {
              await logger.debug('STREAM', 'Yielding tool call from model_end', {
                toolName: toolCall.name,
                toolId: toolCall.id || 'unknown-tool-id'
              });
              yield {type: 'tool_call', tool: {...toolCall, id: toolCall.id ?? 'unknown-tool-id'}} as ToolEvent;
            }
          }
        }

        if (event.event !== 'on_chat_model_stream') continue;
        if (eventCount % 50 === 0) await logger.debug('STREAM', 'Chat model stream progress', {eventCount});

        const chunk = event.data.chunk as AIMessageChunk;
        if (chunk.content && Array.isArray(chunk.content)) {
          for (const contentItem of chunk.content) {
            if (contentItem.type === 'text' && contentItem.text) {
              convState.addTextDelta(contentItem.text);
              yield {type: 'text_delta', content: contentItem.text} as TextStreamEvent;
            }
          }
        }
        if (chunk.content && typeof chunk.content === 'string') {
          convState.addTextDelta(chunk.content);
          yield {type: 'text_delta', content: chunk.content} as TextStreamEvent;
        }
        if (chunk.tool_calls && Array.isArray(chunk.tool_calls)) {
          for (const toolCall of chunk.tool_calls) {
            const toolId = toolCall.id ?? 'unknown-tool-id';
            currentToolId = toolId;
            await logger.debug('STREAM', 'Tool start event from chunk', {toolName: toolCall.name, toolId});
            yield {type: 'tool_start', tool: {name: toolCall.name, id: toolId}} as ToolStartEvent;
          }
        }
        if (chunk.tool_call_chunks && Array.isArray(chunk.tool_call_chunks)) {
          for (const toolCallChunk of chunk.tool_call_chunks) {
            if (toolCallChunk.args && currentToolId) {
              convState.addToolCallDelta(toolCallChunk.args);
              if (eventCount % 30 === 0) await logger.debug('STREAM', 'Tool input delta', {
                toolId: currentToolId,
                argsLength: toolCallChunk.args.length
              });
              yield {type: 'tool_input_delta', content: toolCallChunk.args, toolId: currentToolId} as ToolInputEvent;
            }
          }
        }
      }
      await logger.debug('STREAM', 'Stream completed successfully', {totalEvents: eventCount});
    } catch (error) {
      await logger.error('STREAM', 'Error in stream processing', {
        error: error instanceof Error ? error.stack : String(error),
        eventCount,
        lastEventTime: new Date(lastEventTime).toISOString()
      });
      throw error;
    }
  }
}

const isAnthropicTextContent = (content: any): content is MessageContentText => {
  return typeof content === "object" && content.type === "text";
}
