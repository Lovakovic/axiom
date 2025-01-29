import { generateShellSystemPrompt } from "./shell-system";
import { PromptDefinition, PromptHandlers } from "./types";

export const SYSTEM_PROMPTS: Record<string, PromptDefinition> = {
  "shell-system": {
    name: "shell-system",
    description: "System prompt for shell access with safety guidelines",
    arguments: [
      // existing basic args
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
      },
      // environment details
      {
        name: "architecture",
        description: "System architecture",
        required: false
      },
      {
        name: "default_editor",
        description: "Default system editor",
        required: false
      },
      {
        name: "current_dir",
        description: "Current working directory",
        required: false
      },
      // command availability
      {
        name: "has_tree",
        description: "Whether the tree command is available",
        required: false
      },
      {
        name: "has_git",
        description: "Whether git is available",
        required: false
      },
      {
        name: "has_jq",
        description: "Whether jq is available",
        required: false
      },
      {
        name: "has_curl",
        description: "Whether curl is available",
        required: false
      },
      {
        name: "has_wget",
        description: "Whether wget is available",
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
