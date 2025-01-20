import { AIMessage, isBaseMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { isCommand, isGraphInterrupt } from "@langchain/langgraph";
import { StructuredToolInterface } from "@langchain/core/tools";
import { isLocalTool } from "../local_tools/base";
import { StateAnnotation } from "../llm";

export type ToolNodeOptions = {
  name?: string;
  tags?: string[];
  handleToolErrors?: boolean;
};

export class ToolNode {
  private static tools: StructuredToolInterface[] = [];
  private static handleToolErrors: boolean = true;

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
      return { messages: [] };
    }

    const outputs = await Promise.all(
      tool_calls.map(async (call) => {
        const tool = ToolNode.tools.find((t) => t.name === call.name);

        if (!tool) {
          throw new Error(`Tool "${call.name}" not found.`);
        }

        try {
          const output = await tool.invoke(
            { ...call, type: "tool_call" },
            config
          );

          if (isBaseMessage(output) && output.getType() === "tool" || isCommand(output)) {
            return output;
          }

          return this.createToolMessage(tool, output, call);
        } catch (e: any) {
          console.error(`Error executing tool ${call.name}:`, e);
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
      return { messages: outputs };
    }

    return outputs.map((output) => {
      if (isCommand(output)) {
        return output;
      }
      return {messages: [output]};
    });
  }
}