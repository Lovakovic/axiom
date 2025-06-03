import {AIMessage, BaseMessage, isBaseMessage, ToolMessage} from "@langchain/core/messages";
import {RunnableConfig} from "@langchain/core/runnables";
import {isCommand, isGraphInterrupt} from "@langchain/langgraph";
import {StructuredToolInterface} from "@langchain/core/tools";
import {Logger} from '../../logger';
import {z, ZodObject, ZodType} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {StateAnnotation} from "../base";
import {ToolNodeOptions} from "@langchain/langgraph/prebuilt";

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

    if (tool?.schema) {
      let jsonSchema: object | null = null;
      if (tool.schema instanceof ZodType) {
        jsonSchema = zodToJsonSchema(tool.schema, call.name);
      } else if (typeof tool.schema === 'object') {
        // Assuming it's already a JSON schema-like object
        jsonSchema = tool.schema;
      }

      if (jsonSchema) {
        content += `Expected schema:\n${JSON.stringify(jsonSchema, null, 2)}\n\n`;
      }
    }
    content += `Please retry the tool call with arguments that match this schema.`;

    return new ToolMessage({
      name: call.name,
      content,
      tool_call_id: call.id,
    });
  }

  private static async validateToolInput(tool: StructuredToolInterface | undefined, call: { name: string; args: any; id?: string }, message: AIMessage): Promise<void> {
    if (!tool || !('schema' in tool && tool.schema instanceof z.ZodObject)) {
      return; // Bypass if tool or ZodObject schema is not available for this specific validation.
    }

    const zodSchema = tool.schema as z.ZodObject<any>;
    const schemaShapeKeys = Object.keys(zodSchema.shape);
    const schemaExpectsProperties = schemaShapeKeys.length > 0;

    // If the schema expects properties but the call provides no arguments (or an empty object),
    // add self-reflection details to the AIMessage for the LLM's learning.
    // This does not block the tool call itself; Zod parsing during tool.invoke will handle actual validation.
    if (schemaExpectsProperties && (!call.args || (typeof call.args === 'object' && Object.keys(call.args).length === 0))) {
      const selfReflectionArgs = {
        __reasoning: `I attempted to call the tool '${call.name}' but may have missed providing the required arguments. I should review the tool's schema and ensure all necessary arguments are included.`,
        __expectedSchemaProperties: schemaShapeKeys,
      };

      // Modify the tool_calls array in the AIMessage
      const originalToolCallInMessage = message.tool_calls?.find(tc => tc.id === call.id);
      if (originalToolCallInMessage) {
        originalToolCallInMessage.args = selfReflectionArgs; // Update args in the tool_calls array
      }

      // Also update the 'input' field in the AIMessage's content if it's structured tool_use
      if (Array.isArray(message.content)) {
        const toolUseContent = message.content.find(
          content => typeof content === 'object' && (content as any).type === 'tool_use' && (content as any).id === call.id
        );
        if (toolUseContent && typeof toolUseContent === 'object') {
          (toolUseContent as any).input = JSON.stringify(selfReflectionArgs); // Update input in content array
        }
      }

      await ToolNode.logger.warn('TOOL_NODE', 'Missing arguments for tool expecting properties. Self-reflection added to AIMessage.', {
        toolName: call.name,
        toolId: call.id,
        expectedProperties: schemaShapeKeys,
        modifiedAiMessageArgs: selfReflectionArgs
      });
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
      await ToolNode.logger.debug('TOOL_NODE', 'No tool calls found in AIMessage');
      return { messages: [] };
    }

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
          const errorMsg = `Tool "${call.name}" not found`;
          await ToolNode.logger.error('TOOL_NODE', errorMsg, {
            requestedTool: call.name,
            availableTools: ToolNode.tools.map(t => t.name)
          });
          return ToolNode.createErrorToolMessage({ name: call.name, id: call.id! }, new Error(errorMsg));
        }

        try {
          if ('schema' in tool && tool.schema instanceof ZodObject) {
            const zodSchema = tool.schema as ZodObject<any>;
            if (Object.keys(zodSchema.shape).length === 0) {
              if (call.args === undefined || call.args === null) {
                call.args = {};
                await ToolNode.logger.debug('TOOL_NODE', `Normalized undefined/null call.args to {} for tool '${call.name}'`, { toolId: call.id });
              }
            }
          }

          // Perform self-reflection modification on the AIMessage if applicable
          await ToolNode.validateToolInput(tool, call, message as AIMessage);

          await ToolNode.logger.debug('TOOL_NODE', 'Executing tool', {
            toolName: call.name,
            toolId: call.id,
            arguments: call.args
          });

          const output = await tool.invoke(
            { ...call, type: "tool_call" }, // 'args' is already part of 'call'
            config
          );

          await ToolNode.logger.debug('TOOL_NODE', 'Tool execution completed', {
            toolName: call.name,
            toolId: call.id,
            outputType: typeof output,
            content: output.content,
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

          if (!ToolNode.handleToolErrors) throw e;
          if (isGraphInterrupt(e.name)) throw e;

          return ToolNode.createErrorToolMessage({ name: call.name, id: call.id! }, e, tool);
        }
      })
    );

    if (!outputs.some(isCommand)) {
      await ToolNode.logger.debug('TOOL_NODE', 'All tool executions completed', {
        numOutputs: outputs.length,
        outputTypes: outputs.map(o => (o as any)?.constructor?.name ?? typeof o)
      });
      return { messages: outputs as BaseMessage[] };
    }

    await ToolNode.logger.debug('TOOL_NODE', 'Processing command outputs', {
      numOutputs: outputs.length,
      hasCommands: true
    });

    return {
      messages: outputs as BaseMessage[]
    };
  }
}
