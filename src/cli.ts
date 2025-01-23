import { Agent } from "./agent/llm.js";
import readline from 'readline';

const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

interface ToolStreamState {
    name: string;
    accumulatedInput: string;
}

interface ConversationMessage {
    role: 'human' | 'ai';
    text: string;
}

export class CLI {
    private threadId: string;
    private agent: Agent | null = null;

    private ctrlCCount = 0;
    private ctrlCTimeout: NodeJS.Timeout | null = null;
    private isCurrentlyInterrupted = false;
    private wasInterrupted = false;
    private isProcessingInput = false;

    private inputQueue: string[] = [];
    private currentAbortController: AbortController | null = null;

    /**
     * We keep a buffer of conversation messages (both from user and partial AI).
     * If the user interrupts, we do NOT clear this until we get a successful,
     * uninterrupted completion.
     */
    private conversationBuffer: ConversationMessage[] = [];

    private rl: readline.Interface;

    constructor() {
        this.threadId = Math.random().toString(36).substring(7);
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.setupReadlineHandlers();
        this.handleSignals();
    }

    public async init() {
        this.agent = await Agent.init();
    }

    public async start() {
        console.log("Agent ready! Press Ctrl+C once to interrupt, twice to do nothing, three times to exit.");
        this.rl.prompt();
    }

    private handleSignals() {
        process.on('SIGINT', async () => {
            this.ctrlCCount++;

            // First Ctrl+C → interrupt the stream
            if (this.ctrlCCount === 1) {
                this.isCurrentlyInterrupted = true;
                this.wasInterrupted = true;

                if (this.ctrlCTimeout) {
                    clearTimeout(this.ctrlCTimeout);
                }

                if (this.currentAbortController) {
                    this.currentAbortController.abort();
                    this.currentAbortController = null;
                }

                this.ctrlCTimeout = setTimeout(() => {
                    this.ctrlCCount = 0;
                    this.isCurrentlyInterrupted = false;
                }, 1000);

                this.inputQueue.length = 0;
                this.isProcessingInput = false;

                this.resetReadline();

                // Second Ctrl+C → do nothing
            } else if (this.ctrlCCount === 2) {
                // The user can still press a third time to exit.

                // Third Ctrl+C → hard exit
            } else if (this.ctrlCCount === 3) {
                console.log('\nExiting...');
                process.exit(0);
            }
        });
    }

    private setupReadlineHandlers() {
        this.rl.setPrompt('> ');
        this.rl.on('line', (line) => {
            this.inputQueue.push(line);
            setImmediate(() => this.processNextInput());
        });
    }

    private resetReadline() {
        this.rl.close();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        this.setupReadlineHandlers();
        this.rl.prompt();
    }

    private async processNextInput() {
        if (this.inputQueue.length === 0 || this.isProcessingInput) {
            return;
        }

        this.isProcessingInput = true;
        const line = this.inputQueue.shift()!;

        try {
            await this.handleLine(line);
        } finally {
            this.isProcessingInput = false;
            if (this.inputQueue.length > 0) {
                setImmediate(() => this.processNextInput());
            }
        }
    }

    private async handleLine(line: string) {
        if (!line.trim()) {
            this.rl.prompt();
            return;
        }

        if (!this.agent) {
            console.error("[ERROR] Agent not initialized");
            this.rl.prompt();
            return;
        }

        try {
            // If we had an interruption previously, re-init the agent
            // but preserve the conversationBuffer for context.
            if (this.wasInterrupted) {
                this.agent = await Agent.init();
            }

            // Add the new user message to conversationBuffer
            this.conversationBuffer.push({
                role: 'human',
                text: line
            });

            process.stdout.write("\nAgent: ");

            this.currentAbortController = new AbortController();

            // Stream agent's response
            for await (const event of this.agent.streamResponse(line, this.threadId, {
                signal: this.currentAbortController.signal,
                previousBuffer: this.conversationBuffer
            })) {
                if (this.isCurrentlyInterrupted) {
                    this.isProcessingInput = false;
                    break;
                }

                switch (event.type) {
                    case "text": {
                        process.stdout.write(YELLOW + event.content + RESET);

                        // If this is the first chunk of AI text for this user line,
                        // push a new AI message. Otherwise append to the last message.
                        const lastMsg = this.conversationBuffer[this.conversationBuffer.length - 1];
                        if (!lastMsg || lastMsg.role !== 'ai') {
                            this.conversationBuffer.push({ role: 'ai', text: event.content || '' });
                        } else {
                            lastMsg.text += event.content || '';
                        }
                        break;
                    }
                    case "tool_start": {
                        const toolState: ToolStreamState = {
                            name: event.tool?.name || "unknown-tool",
                            accumulatedInput: ""
                        };
                        process.stdout.write("\n" + BLUE + toolState.name + ": " + RESET);
                        break;
                    }
                    case "tool_input": {
                        process.stdout.write(BLUE + (event.content || "") + RESET);
                        break;
                    }
                }
            }

        } catch (error) {
            if (!this.isCurrentlyInterrupted) {
                console.error("[ERROR] Stream processing error:", error);
            }
        } finally {
            this.currentAbortController = null;

            // IMPORTANT: output a newline so that the next prompt
            // doesn't overwrite the last line of AI text
            process.stdout.write("\n");

            if (!this.isCurrentlyInterrupted) {
                // If we completed without interruption,
                // we can consider the conversation "finished" for now.
                // If you do want multi-turn memory, skip clearing here.
                this.conversationBuffer = [];
                this.wasInterrupted = false;
            }

            if (!this.isCurrentlyInterrupted) {
                this.rl.prompt();
            }
        }
    }
}

// Top-level error handling
process.on('uncaughtException', (error) => {
    console.error('[ERROR] Uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (error) => {
    console.error('[ERROR] Unhandled rejection:', error);
    process.exit(1);
});

/**
 * Main entry point
 */
(async () => {
    try {
        const cli = new CLI();
        await cli.init();
        await cli.start();
    } catch (error) {
        console.error('[ERROR] Main process error:', error);
        process.exit(1);
    }
})();
