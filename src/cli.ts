import { Agent } from "./agent/llm.js";
import readline from 'readline';

// ANSI escape codes for colors
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

async function main() {
  const agent = await Agent.init();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const threadId = Math.random().toString(36).substring(7);
  console.log("Agent ready! Type your messages (ctrl+c to exit)");

  rl.setPrompt('> ');
  rl.prompt();

  rl.on('line', async (line) => {
    try {
      // Start a new line for agent's response
      process.stdout.write("\nAgent: ");

      // Stream the response
      for await (const response of agent.streamResponse(line, threadId)) {
        // Print the response in yellow without adding extra newlines
        process.stdout.write(YELLOW + response + RESET);
      }

      // Add a blank line after response if not already present
      process.stdout.write("\n");
    } catch (error) {
      console.error("Error:", error);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main().catch(console.error);
