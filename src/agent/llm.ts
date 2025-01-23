import {AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage} from "@langchain/core/messages";
import {SystemMessagePromptTemplate} from "@langchain/core/prompts";
import {ChatAnthropic} from "@langchain/anthropic";
import {Annotation, CompiledStateGraph, MemorySaver, messagesStateReducer, StateGraph} from "@langchain/langgraph";
import {DynamicStructuredTool} from "@langchain/core/tools";
import {convertJSONSchemaDraft7ToZod} from "../shared/util/draftToZod";
import {MCPClient} from "./client";
import {ToolNode} from "./util/tool-node";
import {createViewImageTool} from "./local_tools/image_tool";
import os from 'os';
import dotenv from "dotenv";
import { RunnableConfig } from "@langchain/core/runnables";

// Load environment variables
dotenv.config();

// Define the state type for our graph
export const StateAnnotation = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
    }),
    isInterrupted: Annotation<boolean>({
        default: () => false,
        reducer: (state, value) => value,
    })
});

export interface ToolUseEvent {
    name: string;
    id: string;
}

export type StreamEvent = {
    type: "text";
    content: string;
} | {
    type: "tool_start";
    tool: ToolUseEvent;
} | {
    type: "tool_input";
    content: string;
    toolId: string;
};

export class Agent {
    private readonly threadConfig: RunnableConfig & { version: string };

    private readonly app: any;
    private readonly mcpClient: MCPClient;

    private constructor(mcpClient: MCPClient, app: any, threadId: string) {
        this.mcpClient = mcpClient;
        this.app = app;
        // Store thread config at construction
        this.threadConfig = {
            configurable: { thread_id: threadId },
            version: "v2",
            recursionLimit: 75,
        };
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

    static async init(threadId: string): Promise<Agent> {
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

        // Create the model with streaming enabled
        const model = new ChatAnthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: "claude-3-5-sonnet-20241022",
            temperature: 0,
            streaming: true,
        }).bindTools(allTools);

        const systemMessage = await Agent.getSystemMessage(mcpClient);

        // Create our tool node with abort signal handling
        const toolNode = ToolNode.create(allTools, {handleToolErrors: true});

        // Define continue condition
        const shouldContinue = (state: typeof StateAnnotation.State) => {
            if (state.isInterrupted) {
                return "__end__";
            }

            const messages = state.messages;
            const lastMessage = messages[messages.length - 1];

            if (lastMessage?.getType() === "ai" && (lastMessage as AIMessage).tool_calls?.length) {
                return "tools";
            }
            return "__end__";
        };

        // Define model call function with system message and signal handling
        const callModel = async (state: typeof StateAnnotation.State, config?: RunnableConfig) => {
            console.log('Calling model, interrupted:', state.isInterrupted);

            if (state.isInterrupted || state.messages.length === 0) {
                return {};
            }

            const messages = state.messages;

            // Pass the signal to model.invoke
            const response = await model.invoke([systemMessage, ...messages], {
                signal: config?.signal,
            });

            return {messages: [response]};
        };

        // Create and compile the graph
        const workflow = new StateGraph(StateAnnotation)
            .addNode("agent", callModel)
            .addNode("tools", toolNode.invoke)
            .addEdge("__start__", "agent")
            .addConditionalEdges("agent", shouldContinue)
            .addEdge("tools", "agent");

        const checkpointer = new MemorySaver();
        const app = workflow.compile({checkpointer});

        return new Agent(mcpClient, app, threadId);
    }

    async interrupt() {
        await this.app.invoke({ isInterrupted: true }, this.threadConfig);
    }

    async *streamResponse(input: string, config: { signal?: AbortSignal } = {}): AsyncGenerator<StreamEvent> {
        let currentToolId: string | null = null;

        // Create combined config with signal
        const combinedConfig = {
            ...this.threadConfig,
            ...config,
        };

        try {
            for await (const event of this.app.streamEvents(
                {
                    messages: [new HumanMessage(input)],
                    isInterrupted: false
                },
                combinedConfig
            )) {
                if (event.event !== "on_chat_model_stream") {
                    continue;
                }
                const chunk = event.data.chunk as AIMessageChunk;

                for (const contentItem of chunk.content) {
                    if (typeof contentItem === 'string') {
                        yield { type: "text", content: contentItem };
                    }
                    else if (contentItem.type === "text_delta") {
                        if (contentItem.text) {
                            yield { type: "text", content: contentItem.text };
                        }
                    }
                    else if (contentItem.type === "tool_use") {
                        currentToolId = contentItem.id;
                        yield {
                            type: "tool_start",
                            tool: {
                                name: contentItem.name,
                                id: contentItem.id
                            }
                        };
                        if (contentItem.input) {
                            yield {
                                type: "tool_input",
                                content: contentItem.input,
                                toolId: contentItem.id
                            };
                        }
                    }
                    else if (contentItem.type === "input_json_delta") {
                        if (contentItem.input && currentToolId) {
                            yield {
                                type: "tool_input",
                                content: contentItem.input,
                                toolId: currentToolId
                            };
                        }
                    }
                }
            }
        } catch (error) {
            // Check if this is an abort error
            if ((error as Error).name === 'AbortError') {
                console.log('[DEBUG] Stream aborted');
            } else {
                throw error;  // Re-throw non-abort errors
            }
        }
    }
}
