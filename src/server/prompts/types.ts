import type { GetPromptResult, Prompt } from "@modelcontextprotocol/sdk/types.js";

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
  [key: string]: unknown;
}

export interface PromptDefinition extends Prompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export type PromptHandler = (args: Record<string, unknown>) => GetPromptResult;

export type PromptHandlers = {
  [K in "shell-system"]: PromptHandler;
};