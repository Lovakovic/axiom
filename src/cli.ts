import { Agent } from "./agent/llm.js";
import readline from 'readline';

async function main() {
  const agent = new Agent("");

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
      const response = await agent.process(line, threadId);
      console.log("\nAgent:", response, "\n");
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