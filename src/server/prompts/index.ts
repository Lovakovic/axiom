import { generateShellSystemPrompt } from './shell-system';
import { PromptDefinition, PromptHandlers } from "./types";

export const SYSTEM_PROMPTS: Record<string, PromptDefinition> = {
  "shell-system": {
    name: "shell-system",
    description: "System prompt for shell access with safety guidelines",
    arguments: [
      {
        name: "user",
        description: "Username or identifier",
        required: false
      },
      {
        name: "OS",
        description: "Operating system information",
        required: false
      },
      {
        name: "shell_type",
        description: "Type of shell (bash, zsh, etc.)",
        required: false
      },
      {
        name: "date_time",
        description: "Current date and time",
        required: false
      }
    ]
  }
};

export const promptHandlers: PromptHandlers = {
  "shell-system": (args: Record<string, unknown>) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: generateShellSystemPrompt(args)
          }
        }
      ]
    };
  }
};