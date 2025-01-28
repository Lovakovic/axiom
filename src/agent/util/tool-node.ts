import { AIMessage, isBaseMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { isCommand, isGraphInterrupt } from "@langchain/langgraph";
import { StructuredToolInterface } from "@langchain/core/tools";
import { isLocalTool } from "../local_tools/base";
import { StateAnnotation } from "../llm";
import { Logger } from '../../logger';

export type ToolNodeOptions = {
  name?: string;
  tags?: string[];
  handleToolErrors?: boolean;
};

export class ToolNode {
  private static tools: StructuredToolInterface[] = [];
  private static handleToolErrors: boolean = true;
  private readonly logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
  }

  static create(tools: StructuredToolInterface[], options?: ToolNodeOptions) {
    ToolNode.tools = tools;
    ToolNode.handleToolErrors = options?.handleToolErrors ?? true;
    return new ToolNode();
  }

  private createToolMessage(tool: StructuredToolInterface, output: any, call: { name: string; id?: string }): ToolMessage {
    if (isLocalTool(tool)) {
      if (tool.outputFormat.method === 'value') {
        return new ToolMessage({
          name: call.name,
          content: output,
          tool_call_id: call.id ?? "",
        });
      }
    }

    return new ToolMessage({
      name: call.name,
      content: typeof output === "string" ? output : JSON.stringify(output),
      tool_call_id: call.id ?? "",
    });
  }

  async invoke(state: typeof StateAnnotation.State, config?: RunnableConfig) {
    const messages = state.messages;
    const message = messages[messages.length - 1];

    if (!message || message.getType() !== "ai") {
      throw new Error("ToolNode only accepts AIMessages as input.");
    }

    const tool_calls = (message as AIMessage).tool_calls;
    if (!tool_calls) {
      await this.logger.debug('TOOL_NODE', 'No tool calls found in message');
      return { messages: [] };
    }

    await this.logger.info('TOOL_NODE', 'Processing tool calls', {
      numCalls: tool_calls.length,
      toolNames: tool_calls.map(call => call.name)
    });

    const outputs = await Promise.all(
      tool_calls.map(async (call) => {
        const tool = ToolNode.tools.find((t) => t.name === call.name);

        if (!tool) {
          const error = `Tool "${call.name}" not found`;
          await this.logger.error('TOOL_NODE', error, {
            requestedTool: call.name,
            availableTools: ToolNode.tools.map(t => t.name)
          });
          throw new Error(error);
        }

        try {
          await this.logger.debug('TOOL_NODE', 'Executing tool', {
            toolName: call.name,
            toolId: call.id,
            arguments: call.args
          });

          const output = await tool.invoke(
            { ...call, type: "tool_call" },
            config
          );

          await this.logger.debug('TOOL_NODE', 'Tool execution completed', {
            toolName: call.name,
            toolId: call.id,
            outputType: typeof output,
            isMessage: isBaseMessage(output),
            isCommand: isCommand(output)
          });

          if (isBaseMessage(output) && output.getType() === "tool" || isCommand(output)) {
            return output;
          }

          return this.createToolMessage(tool, output, call);
        } catch (e: any) {
          await this.logger.error('TOOL_NODE', `Error executing tool ${call.name}`, {
            error: e instanceof Error ? e.stack : String(e),
            toolName: call.name,
            toolId: call.id,
            arguments: call.args
          });

          if (!ToolNode.handleToolErrors) {
            throw e;
          }
          if (isGraphInterrupt(e.name)) {
            throw e;
          }
          return new ToolMessage({
            content: `Error: ${e.message}\n Please try again with correct parameters.`,
            name: call.name,
            tool_call_id: call.id ?? "",
          });
        }
      })
    );

    if (!outputs.some(isCommand)) {
      await this.logger.debug('TOOL_NODE', 'All tool executions completed', {
        numOutputs: outputs.length,
        outputTypes: outputs.map(o => typeof o)
      });
      return { messages: outputs };
    }

    await this.logger.debug('TOOL_NODE', 'Processing command outputs', {
      numOutputs: outputs.length,
      hasCommands: true
    });

    return outputs.map((output) => {
      if (isCommand(output)) {
        return output;
      }
      return {messages: [output]};
    });
  }
}