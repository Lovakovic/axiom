import { DynamicStructuredTool, StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

export type OutputFormat = {
  method: 'value' | 'content';
  format?: 'string' | 'complex';
};


export class LocalTool extends DynamicStructuredTool {
  outputFormat: OutputFormat;

  constructor({
                name,
                description,
                schema,
                func,
                outputFormat
              }: {
    name: string;
    description: string;
    schema: z.ZodObject<any>;
    func: (input: Record<string, any>) => Promise<any>;
    outputFormat: OutputFormat;
  }) {
    super({
      name,
      description,
      schema,
      func
    });
    this.outputFormat = outputFormat;
  }
}

// Type guard to check if a tool is a LocalTool
export function isLocalTool(tool: any): tool is LocalTool {
  return tool instanceof LocalTool;
}