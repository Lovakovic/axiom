import {Agent} from "./agent/llm.js";
import readline from 'readline';

// ANSI escape codes for colors
const YELLOW = '\x1b[33m';
const ORANGE = '\x1b[34m';
const RESET = '\x1b[0m';

// Interface for tracking tool streaming state
interface ToolStreamState {
    name: string;
    accumulatedInput: string;
}

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

    rl.on("line", async (line) => {
        try {
            // Start a new line for the agent's response
            process.stdout.write("\nAgent: ");

            // Track active tools by their ID
            const activeTools = new Map<string, ToolStreamState>();

            // Stream and format the response
            for await (const event of agent.streamResponse(line, threadId)) {
                switch (event.type) {
                    case "text":
                        // Normal LLM partial text in yellow
                        process.stdout.write(YELLOW + event.content + RESET);
                        break;

                    case "tool_start":
                        // Start tracking a new tool
                        activeTools.set(event.tool.id, {
                            name: event.tool.name,
                            accumulatedInput: ''
                        });
                        // Start a new line for the tool
                        process.stdout.write("\n" + ORANGE + event.tool.name + ": " + RESET);
                        break;

                    case "tool_input":
                        const tool = activeTools.get(event.toolId);
                        if (tool) {
                            tool.accumulatedInput += event.content;
                            // Update the line for this specific tool
                            process.stdout.write("\r" + ORANGE + tool.name + ": " +
                                tool.accumulatedInput + RESET + ' '.repeat(20));
                        }
                        break;
                }
            }

            // Add a blank line after the response is fully done
            if (activeTools.size > 0) {
                process.stdout.write("\n");
            }

            // Clear active tools for next interaction
            activeTools.clear();
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
