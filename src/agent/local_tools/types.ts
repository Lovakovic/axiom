import { StructuredToolInterface } from "@langchain/core/tools";

export type OutputFormat = {
  method: 'value' | 'content';
  format?: 'string' | 'complex';
};

export interface LocalTool extends StructuredToolInterface {
  outputFormat: OutputFormat;
}

// Custom type guard to check if a tool is a LocalTool
export function isLocalTool(tool: any): tool is LocalTool {
  return 'outputFormat' in tool &&
    'method' in (tool.outputFormat as OutputFormat) &&
    ['value', 'content'].includes((tool.outputFormat as OutputFormat).method);
}

export type ViewImageToolInput = {
  path: string;
};