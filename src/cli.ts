import {Agent} from "./agent/llm.js";
import readline from 'readline';

// ANSI escape codes for colors
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

// Interface for tracking tool streaming state
interface ToolStreamState {
    name: string;
    accumulatedInput: string;
}

async function main() {
    const agent = await Agent.init();
    let ctrlCCount = 0;
    let ctrlCTimeout: NodeJS.Timeout | null = null;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
        ctrlCCount++;

        if (ctrlCCount === 1) {
            // First Ctrl+C: Try to cancel current generation
            if (agent.cancelGeneration()) {
                console.log('\nCancelling current generation...');
            }

            // Reset counter after 1 second
            if (ctrlCTimeout) {
                clearTimeout(ctrlCTimeout);
            }
            ctrlCTimeout = setTimeout(() => {
                ctrlCCount = 0;
            }, 1000);
        } else if (ctrlCCount === 3) {
            // Third Ctrl+C: Exit the program
            console.log('\nExiting...');
            process.exit(0);
        }

        // Re-display prompt after Ctrl+C
        process.stdout.write('\n');
        rl.prompt();
    });

    const threadId = Math.random().toString(36).substring(7);
    console.log("Agent ready! Type your messages (Ctrl+C to cancel, press 3 times to exit)");

    rl.setPrompt('> ');
    rl.prompt();

    rl.on("line", async (line) => {
        try {
            process.stdout.write("\nAgent: ");
            const activeTools = new Map<string, ToolStreamState>();

            for await (const event of agent.streamResponse(line, threadId)) {
                switch (event.type) {
                    case "text":
                        process.stdout.write(YELLOW + event.content + RESET);
                        break;

                    case "tool_start":
                        activeTools.set(event.tool.id, {
                            name: event.tool.name,
                            accumulatedInput: ''
                        });
                        process.stdout.write("\n" + BLUE + event.tool.name + ": " + RESET);
                        break;

                    case "tool_input":
                        const tool = activeTools.get(event.toolId);
                        if (tool) {
                            process.stdout.write(BLUE + event.content + RESET);
                            tool.accumulatedInput += event.content;
                        }
                        break;
                }
            }

            if (activeTools.size > 0) {
                process.stdout.write("\n");
            }
            activeTools.clear();
        } catch (error) {
            console.error("\nError:", error);
        }
        rl.prompt();
    });

}

main().catch(console.error);
