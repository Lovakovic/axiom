import { Agent } from "./agent/llm.js";
import readline from 'readline';
import { MCPClient } from "./agent/client";

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
    private readonly threadId: string;
    private agent!: Agent;
    private mcpClient!: MCPClient;
    private readonly originalStderr: NodeJS.WriteStream['write'];

    private ctrlCCount = 0;
    private ctrlCTimeout: NodeJS.Timeout | null = null;
    private isCurrentlyInterrupted = false;
    private wasInterrupted = false;
    private isProcessingInput = false;

    private readonly inputQueue: string[] = [];
    private currentAbortController: AbortController | null = null;

    private conversationBuffer: ConversationMessage[] = [];
    private rl: readline.Interface;

    constructor() {
        this.threadId = Math.random().toString(36).substring(7);
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.originalStderr = process.stderr.write.bind(process.stderr);

        process.stderr.write = ((
          buffer: string | Uint8Array,
          encoding?: BufferEncoding,
          cb?: (err?: Error) => void
        ): boolean => {
            const text = buffer.toString();
            if (text.includes('Error in handler EventStreamCallbackHandler')) {
                if (cb) cb();
                return true;
            }
            return this.originalStderr(buffer, encoding, cb);
        }) as typeof process.stderr.write;

        this.setupReadlineHandlers();
        this.handleSignals();
    }

    public async init() {
        this.mcpClient = new MCPClient();
        await this.mcpClient.connect("node", ["dist/server/index.js"]);
        this.agent = await Agent.init(this.mcpClient);
    }

    public async start() {
        console.log("Agent ready! Press Ctrl+C once to interrupt, twice to do nothing, three times to exit.");
        this.rl.prompt();
    }

    private handleSignals() {
        process.on('SIGINT', async () => {
            this.ctrlCCount++;

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

                process.stdout.write("\n");

                this.resetReadline();

            } else if (this.ctrlCCount === 3) {
                console.log('\nExiting...');
                await this.cleanup();
                process.exit(0);
            }
        });
    }

    private setupReadlineHandlers() {
        this.rl.setPrompt('> ');

        // Remove any existing line listeners
        this.rl.removeAllListeners('line');

        this.rl.on('line', (line) => {
            this.inputQueue.push(line);

            // Ensure we're processing input
            setImmediate(() => {
                this.processNextInput();
            });
        });
    }

    private resetReadline() {
        // Create new interface with explicit terminal settings
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: '> ',
            terminal: true
        });

        // Set up new handlers
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

        // Ensure readline is ready
        if (!this.rl.terminal) {
            this.resetReadline();
            return;
        }

        try {
            if (this.wasInterrupted) {
                this.mcpClient = new MCPClient();
                await this.mcpClient.connect("node", ["dist/server/index.js"]);
                this.agent = await Agent.init(this.mcpClient);
            }

            this.conversationBuffer.push({
                role: 'human',
                text: line
            });

            process.stdout.write("\nAgent: ");

            this.currentAbortController = new AbortController();

            for await (const event of this.agent.streamResponse(line, this.threadId, {
                signal: this.currentAbortController.signal,
                previousBuffer: this.conversationBuffer
            })) {
                if (this.isCurrentlyInterrupted) {
                    this.isProcessingInput = false;
                    process.stdout.write("\n");
                    break;
                }

                switch (event.type) {
                    case "text": {
                        process.stdout.write(YELLOW + event.content + RESET);

                        const lastMsg = this.conversationBuffer[this.conversationBuffer.length - 1];
                        if (!lastMsg || lastMsg.role !== 'ai') {
                            this.conversationBuffer.push({ role: 'ai', text: event.content || '' });
                        } else {
                            lastMsg.text += event.content || '';
                        }
                        break;
                    }
                    case "tool_start": {
                        process.stdout.write("\n" + BLUE + event.tool.name + ": " + RESET);
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

            if (!this.isCurrentlyInterrupted) {
                process.stdout.write("\n");
                this.conversationBuffer = [];
                this.wasInterrupted = false;

                // Force readline refresh
                setImmediate(() => {
                    this.rl.prompt(true);
                });
            }

            if (!this.isCurrentlyInterrupted) {
                // Ensure readline is responsive
                process.stdin.resume();
                this.rl.prompt(true);
            }
        }
    }

    private async cleanup() {
        process.stderr.write = this.originalStderr;

        if (this.mcpClient) {
            try {
                await this.mcpClient.disconnect();
            } catch (error) {
                console.error('Error during MCP client cleanup:', error);
            }
        }

        this.rl.close();
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