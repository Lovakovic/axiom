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
    const threadId = Math.random().toString(36).substring(7);
    const agent = await Agent.init(threadId);
    let ctrlCCount = 0;
    let ctrlCTimeout: NodeJS.Timeout | null = null;
    let isCurrentlyInterrupted = false;
    let accumulatedOutput = '';

    let wasInterrupted = false;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Handle Ctrl+C
    process.on('SIGINT', async () => {
        ctrlCCount++;

        if (ctrlCCount === 1) {
            isCurrentlyInterrupted = true;
            wasInterrupted = true;
            await agent.interrupt();
            console.log('\nCancelling current generation...');

            if (ctrlCTimeout) {
                clearTimeout(ctrlCTimeout);
            }
            ctrlCTimeout = setTimeout(() => {
                ctrlCCount = 0;
            }, 1000);
        } else if (ctrlCCount === 3) {
            console.log('\nExiting...');
            process.exit(0);
        }

        process.stdout.write('\n');
        rl.prompt();
    });

    console.log("Agent ready! Type your messages (Ctrl+C to cancel, press 3 times to exit)");

    rl.setPrompt('> ');
    rl.prompt();

    rl.on("line", async (line) => {
        try {
            console.log("\nProcessing new input, wasInterrupted:", wasInterrupted);

            if (wasInterrupted) {
                console.log("Attempting to reset agent state...");
                await agent.resetState();
                wasInterrupted = false;
                console.log("Agent state reset complete");
            }

            isCurrentlyInterrupted = false;
            process.stdout.write("\nAgent: ");
            const activeTools = new Map<string, ToolStreamState>();
            accumulatedOutput = '';

            console.log("Starting stream response...");
            for await (const event of agent.streamResponse(line)) {
                // Break out if we've been interrupted
                if (isCurrentlyInterrupted) {
                    console.log("Stream interrupted, breaking...");
                    break;
                }

                switch (event.type) {
                    case "text":
                        accumulatedOutput += event.content;
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
