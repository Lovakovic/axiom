// src/cli.ts
import { Agent } from "./agent/llm.js";
import readline from 'readline';

const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

interface ToolStreamState {
    name: string;
    accumulatedInput: string;
}

/**
 * Each item in our conversation buffer explicitly tracks its role
 * and the text content. This helps us reconstruct the conversation
 * properly in `streamResponse`.
 */
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

    // This was your old textBuffer for debugging or partial outputs,
    // but we'll keep it minimal now.
    private debugTextBuffer = '';

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

    /**
     * Initialize the agent
     */
    public async init() {
        this.agent = await Agent.init();
    }

    /**
     * Start the CLI prompt
     */
    public async start() {
        console.log("Agent ready! Type your messages (Ctrl+C once to interrupt, 3 times to exit)");
        this.rl.prompt();
    }

    /**
     * Setup Ctrl+C signals
     */
    private handleSignals() {
        process.on('SIGINT', async () => {
            this.ctrlCCount++;

            if (this.ctrlCCount === 1) {
                // First time we see Ctrl+C
                this.isCurrentlyInterrupted = true;
                this.wasInterrupted = true;

                if (this.ctrlCTimeout) {
                    clearTimeout(this.ctrlCTimeout);
                }

                // Abort any ongoing LLM streaming
                if (this.currentAbortController) {
                    this.currentAbortController.abort();
                    this.currentAbortController = null;
                }

                // Reset ctrlCCount after 1 second if no new interrupts
                this.ctrlCTimeout = setTimeout(() => {
                    this.ctrlCCount = 0;
                    this.isCurrentlyInterrupted = false;
                }, 1000);

                // Clear queued lines & reset
                this.inputQueue.length = 0;
                this.isProcessingInput = false;

                // Force a fresh prompt
                this.resetReadline();

            } else if (this.ctrlCCount === 3) {
                // Hard exit
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

    /**
     * Called for every line the user enters.
     */
    private async handleLine(line: string) {
        if (!line.trim()) {
            this.rl.prompt();
            return;
        }

        if (!this.agent) {
            this.rl.prompt();
            return;
        }

        try {
            // If we had an interruption previously, re-init the agent
            // but preserve the conversationBuffer for context.
            if (this.wasInterrupted) {
                this.agent = await Agent.init();
            }

            // 1) Add the new user message to conversationBuffer
            this.conversationBuffer.push({
                role: 'human',
                text: line
            });

            process.stdout.write("\nAgent: ");

            // 2) Prepare streaming
            this.currentAbortController = new AbortController();

            // 3) Call our updated streamResponse
            for await (const event of this.agent.streamResponse(line, this.threadId, {
                signal: this.currentAbortController.signal,
                previousBuffer: this.conversationBuffer // pass entire buffer
            })) {
                // Break early if the user interrupted
                if (this.isCurrentlyInterrupted) {
                    this.isProcessingInput = false;
                    break;
                }

                switch (event.type) {
                    case "text":
                        // This is partial AI text streaming in
                        process.stdout.write(YELLOW + event.content + RESET);

                        // If this is the first AI chunk for this user line, we may need
                        // to push a new AI item to the buffer. We can do so if the last
                        // message is *not* AI. If it is AI, just append to it.
                        const lastMessage =
                            this.conversationBuffer[this.conversationBuffer.length - 1];
                        if (!lastMessage || lastMessage.role !== 'ai') {
                            this.conversationBuffer.push({ role: 'ai', text: event.content || '' });
                        } else {
                            lastMessage.text += event.content || '';
                        }

                        // For debugging, also store partial text
                        this.debugTextBuffer += event.content || '';
                        break;

                    case "tool_start": {
                        // Optionally handle a tool invocation start
                        const toolState: ToolStreamState = {
                            name: event.tool?.name || "unknown-tool",
                            accumulatedInput: ""
                        };
                        process.stdout.write("\n" + BLUE + toolState.name + ": " + RESET);
                        break;
                    }

                    case "tool_input": {
                        // Partial input for the tool
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

            if (!this.isCurrentlyInterrupted) {
                // If we completed without interruption,
                // we can consider the conversation "finished" for now.
                // If you want multi-turn conversation *including history*,
                // you might NOT want to clear here. But if the user wants
                // each question to start fresh once complete, then:
                this.conversationBuffer = [];
                this.debugTextBuffer = '';
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
