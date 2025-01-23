import { Agent } from "./agent/llm.js";
import readline from 'readline';

const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

interface ToolStreamState {
    name: string;
    accumulatedInput: string;
}

async function main() {
    const threadId = Math.random().toString(36).substring(7);
    let agent = await Agent.init(threadId);
    let ctrlCCount = 0;
    let ctrlCTimeout: NodeJS.Timeout | null = null;
    let isCurrentlyInterrupted = false;
    let accumulatedOutput = '';
    let wasInterrupted = false;
    let isProcessingInput = false;

    // Create a queue for buffering inputs during processing
    const inputQueue: string[] = [];

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    async function processNextInput() {
        if (inputQueue.length === 0 || isProcessingInput) {
            return;
        }

        isProcessingInput = true;
        const line = inputQueue.shift()!;

        try {
            await handleLine(line);
        } finally {
            isProcessingInput = false;
            // Process next item in queue if any
            if (inputQueue.length > 0) {
                setImmediate(processNextInput);
            }
        }
    }

    // Handle Ctrl+C
    process.on('SIGINT', async () => {
        ctrlCCount++;
        console.log('\n[DEBUG] Received interrupt signal');
        console.log('[DEBUG] Current ctrlCCount:', ctrlCCount);

        if (ctrlCCount === 1) {
            isCurrentlyInterrupted = true;
            wasInterrupted = true;

            try {
                await agent.interrupt();
                console.log('Successfully interrupted agent');
            } catch (error) {
                console.error('[ERROR] Failed to interrupt agent:', error);
            }

            if (ctrlCTimeout) {
                clearTimeout(ctrlCTimeout);
            }
            ctrlCTimeout = setTimeout(() => {
                ctrlCCount = 0;
            }, 1000);
        } else if (ctrlCCount === 3) {
            console.log('\nForce exiting...');
            process.exit(0);
        }

        // Clear the input queue on interruption
        inputQueue.length = 0;
        rl.prompt();
    });

    async function handleLine(line: string) {
        console.log("[DEBUG] Processing line:", line);

        if (!line.trim()) {
            rl.prompt();
            return;
        }

        try {
            if (wasInterrupted || isCurrentlyInterrupted) {
                console.log("[DEBUG] Creating new agent after interruption");
                const newAgent = await Agent.init(threadId);
                agent = newAgent;
                wasInterrupted = false;
                isCurrentlyInterrupted = false;
            }

            process.stdout.write("\nAgent: ");
            const activeTools = new Map<string, ToolStreamState>();
            accumulatedOutput = '';

            const controller = new AbortController();
            console.log("[DEBUG] Starting stream response");

            try {
                for await (const event of agent.streamResponse(line, {
                    signal: controller.signal
                })) {
                    // if (isCurrentlyInterrupted) {
                    //     console.log("[DEBUG] Detected interruption, aborting stream");
                    //     controller.abort();
                    //     break;
                    // }

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
            } catch (error) {
                if (!isCurrentlyInterrupted) {
                    console.error("[ERROR] Stream processing error:", error);
                }
            } finally {
                console.log("[DEBUG] Stream processing complete");
                if (activeTools.size > 0) {
                    process.stdout.write("\n");
                }
                activeTools.clear();
            }
        } catch (error) {
            console.error("[ERROR] Error in message processing:", error);
        } finally {
            rl.prompt();
        }
    }

    // Handle line input by queueing
    rl.on('line', (line) => {
        console.log("[DEBUG] Line event received:", line);
        inputQueue.push(line);
        setImmediate(processNextInput);
    });

    console.log("Agent ready! Type your messages (Ctrl+C to cancel, press 3 times to exit)");
    rl.setPrompt('> ');
    rl.prompt();
}

main().catch(console.error);
