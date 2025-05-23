import {AIMessage, BaseMessage, isBaseMessage, ToolMessage} from "@langchain/core/messages";
import {RunnableConfig} from "@langchain/core/runnables";
import {isCommand, isGraphInterrupt} from "@langchain/langgraph";
import {StructuredToolInterface} from "@langchain/core/tools";
import {isLocalTool} from "../local_tools/base";
import {Logger} from '../../logger';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {StateAnnotation} from "../base";

export type ToolNodeOptions = {
  name?: string;
  tags?: string[];
  handleToolErrors?: boolean;
};

export class ToolNode {
  private static tools: StructuredToolInterface[] = [];
  private static handleToolErrors: boolean = true;
  private static logger: Logger;

  static async create(tools: StructuredToolInterface[], options?: ToolNodeOptions) {
    ToolNode.logger = await Logger.init();
    ToolNode.tools = tools;
    ToolNode.handleToolErrors = options?.handleToolErrors ?? true;
    return new ToolNode();
  }

  private static createToolMessage(tool: StructuredToolInterface, output: any, call: {
    name: string;
    id?: string
  }): ToolMessage {
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

  private static createErrorToolMessage(
    call: { name: string; id: string },
    error: Error,
    tool?: StructuredToolInterface
  ): ToolMessage {
    let content = `Error: ${error.message}\n\n`;

    if (tool?.schema instanceof z.ZodObject) {
      const jsonSchema = zodToJsonSchema(tool.schema, call.name);
      content += `Expected schema:\n${JSON.stringify(jsonSchema, null, 2)}\n\n`;
      content += `Please retry the tool call with arguments that match this schema.`;
    } else {
      content += `Please ensure your tool call arguments match the required schema.`;
    }

    return new ToolMessage({
      name: call.name,
      content,
      tool_call_id: call.id,
    });
  }

  private static async validateToolInput(tool: StructuredToolInterface, call: { name: string; args: any; id?: string }, message: AIMessage) {
    try {
      await ToolNode.logger.debug('TOOL_NODE', 'Validating tool input', {
        toolName: call.name,
        toolId: call.id,
        originalArgs: call.args
      });

      // For empty or undefined args, modify both tool_calls and content
      if (!call.args || Object.keys(call.args).length === 0) {
        const selfReflectionArgs = {
          __reasoning: "I notice I called this tool but might have failed to provide the required arguments. This could be a mistake in my tool usage. I should review the tool's schema and provide all necessary arguments.",
        };

        // Find and modify the original tool call in the message
        const originalToolCall = message.tool_calls?.find(tc => tc.id === call.id);
        if (originalToolCall) {
          originalToolCall.args = selfReflectionArgs;

          // Update our local reference to match
          call.args = selfReflectionArgs;

          // Find and update the corresponding tool_use content
          if (Array.isArray(message.content)) {
            const toolUseContent = message.content.find(
              content =>
                typeof content === 'object' &&
                'type' in content &&
                content.type === 'tool_use' &&
                'id' in content &&
                content.id === call.id
            );

            if (toolUseContent && typeof toolUseContent === 'object') {
              // Update the input field with stringified self-reflection args
              (toolUseContent as any).input = JSON.stringify(selfReflectionArgs);
            }
          }
        }

        await ToolNode.logger.warn('TOOL_NODE', 'Empty arguments detected, adding self-reflection', {
          toolName: call.name,
          toolId: call.id,
          modifiedArgs: call.args
        });

        return false;
      }

      // For DynamicStructuredTool, validate against its schema
      if ('schema' in tool && tool.schema instanceof z.ZodObject) {
        await tool.schema.parseAsync(call.args);
        return true;
      }
      return true;
    } catch (error) {
      // Corrected logic:
      let schemaForLogging: object | null = null;
      if (tool.schema) {
        if (tool.schema instanceof z.ZodType) {
          // tool.schema is a Zod schema, so we can convert it
          schemaForLogging = zodToJsonSchema(tool.schema, call.name);
        } else {
          // This is already in a JSON schema format, so we can use it directly.
          schemaForLogging = tool.schema;
        }
      }

      await ToolNode.logger.warn('TOOL_NODE', 'Tool input validation failed', {
        toolName: call.name,
        toolId: call.id,
        error: error instanceof Error ? error.message : String(error),
        providedArgs: call.args,
        schema: schemaForLogging // Use the correctly processed schema
      });
      return false;
    }
  }

  async invoke(state: typeof StateAnnotation.State, config?: RunnableConfig): Promise<{ messages: BaseMessage[] }> {
    const messages = state.messages;
    const message = messages[messages.length - 1];

    if (!message || message.getType() !== "ai") {
      throw new Error("ToolNode only accepts AIMessages as input.");
    }

    const tool_calls = (message as AIMessage).tool_calls;
    if (!tool_calls) {
      await ToolNode.logger.debug('TOOL_NODE', 'No tool calls found in message');
      return {messages: []};
    }

    // Add validation for tool call IDs
    const missingIds = tool_calls.filter(call => !call.id);
    if (missingIds.length > 0) {
      await ToolNode.logger.error('TOOL_NODE', 'Tool calls missing IDs', {
        invalidCalls: missingIds.map(call => ({
          name: call.name,
          args: call.args
        }))
      });
      throw new Error('All tool calls must have valid IDs. This is required for proper message tracking.');
    }

    await ToolNode.logger.info('TOOL_NODE', 'Processing tool calls', {
      numCalls: tool_calls.length,
      toolNames: tool_calls.map(call => call.name)
    });

    const outputs = await Promise.all(
      tool_calls.map(async (call) => {
        const tool = ToolNode.tools.find((t) => t.name === call.name);

        if (!tool) {
          const error = `Tool "${call.name}" not found`;
          await ToolNode.logger.error('TOOL_NODE', error, {
            requestedTool: call.name,
            availableTools: ToolNode.tools.map(t => t.name)
          });
          return ToolNode.createErrorToolMessage({name: call.name, id: call.id!}, new Error(error));
        }

        try {
          // Validate tool input before execution, passing the original message
          const isValid = await ToolNode.validateToolInput(tool, call, message);
          if (!isValid) {
            return ToolNode.createErrorToolMessage({
              name: call.name,
              id: call.id!
            }, new Error('Invalid tool arguments'), tool);
          }

          await ToolNode.logger.debug('TOOL_NODE', 'Executing tool', {
            toolName: call.name,
            toolId: call.id,
            arguments: call.args
          });

          const output = await tool.invoke(
            {...call, type: "tool_call"},
            config
          );

          await ToolNode.logger.debug('TOOL_NODE', 'Tool execution completed', {
            toolName: call.name,
            toolId: call.id,
            outputType: typeof output,
            isMessage: isBaseMessage(output),
            isCommand: isCommand(output)
          });

          if (isBaseMessage(output) && output.getType() === "tool") {
            return output;
          }

          return ToolNode.createToolMessage(tool, output, call);
        } catch (e: any) {
          await ToolNode.logger.error('TOOL_NODE', `Error executing tool ${call.name}`, {
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

          // Create a tool message with the error instead of throwing
          return ToolNode.createErrorToolMessage({name: call.name, id: call.id!}, e, tool);
        }
      })
    );

    if (!outputs.some(isCommand)) {
      await ToolNode.logger.debug('TOOL_NODE', 'All tool executions completed', {
        numOutputs: outputs.length,
        outputTypes: outputs.map(o => typeof o)
      });
      return {messages: outputs};
    }

    await ToolNode.logger.debug('TOOL_NODE', 'Processing command outputs', {
      numOutputs: outputs.length,
      hasCommands: true
    });

    return {
      messages: outputs
    }
  }
}
