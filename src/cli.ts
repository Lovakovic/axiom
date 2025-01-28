import { Agent } from "./agent/llm.js";
import readline from 'readline';
import { MCPClient } from "./agent/client";
import { Logger } from './logger';

const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

interface ConversationMessage {
  role: 'human' | 'ai';
  text: string;
}

export class CLI {
  private readonly threadId: string;
  private agent!: Agent;
  private mcpClient!: MCPClient;
  private readonly originalStderr: NodeJS.WriteStream['write'];
  private readonly logger: Logger;

  private ctrlCCount = 0;
  private ctrlCTimeout: NodeJS.Timeout | null = null;
  private isCurrentlyInterrupted = false;
  private wasInterrupted = false;
  private isProcessingInput = false;

  private readonly inputQueue: string[] = [];
  private currentAbortController: AbortController | null = null;

  private conversationBuffer: ConversationMessage[] = [];
  private rl: readline.Interface;

  constructor(logger: Logger) {
    this.logger = logger;
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
    await this.logger.info('INIT', 'Initializing CLI', {
      threadId: this.threadId
    });

    await this.logger.info('INIT', 'Starting MCP client initialization');
    this.mcpClient = new MCPClient();
    await this.mcpClient.connect("node", ["dist/server/index.js"]);
    this.agent = await Agent.init(this.mcpClient);
    await this.logger.info('INIT', 'MCP client and agent initialized successfully');
  }

  public async start() {
    this.logger.info('START', 'CLI starting');
    console.log("Agent ready! Press Ctrl+C once to interrupt, twice to do nothing, three times to exit.");
    this.rl.prompt();
  }

  private handleSignals() {
    process.on('SIGINT', async () => {
      this.ctrlCCount++;

      await this.logger.info('INTERRUPT', 'Interrupt signal received', {
        ctrlCCount: this.ctrlCCount,
        currentFlags: {
          isCurrentlyInterrupted: this.isCurrentlyInterrupted,
          wasInterrupted: this.wasInterrupted,
          isProcessingInput: this.isProcessingInput
        }
      });

      if (this.ctrlCCount === 1) {
        const previousFlags = {
          isCurrentlyInterrupted: this.isCurrentlyInterrupted,
          wasInterrupted: this.wasInterrupted
        };

        this.isCurrentlyInterrupted = true;
        this.wasInterrupted = true;

        await this.logger.info('INTERRUPT', 'First interrupt - updating flags', {
          previous: previousFlags,
          current: {
            isCurrentlyInterrupted: this.isCurrentlyInterrupted,
            wasInterrupted: this.wasInterrupted
          }
        });

        if (this.ctrlCTimeout) {
          clearTimeout(this.ctrlCTimeout);
        }

        if (this.currentAbortController) {
          this.currentAbortController.abort();
          this.currentAbortController = null;
          await this.logger.debug('INTERRUPT', 'Aborted current controller');
        }

        this.ctrlCTimeout = setTimeout(() => {
          this.ctrlCCount = 0;
          this.isCurrentlyInterrupted = false;
          this.logger.info('INTERRUPT', 'Interrupt timeout - resetting flags', {
            ctrlCCount: 0,
            isCurrentlyInterrupted: false
          });
        }, 1000);

        this.inputQueue.length = 0;
        this.isProcessingInput = false;

        await this.logger.debug('INTERRUPT', 'Reset input state', {
          queueLength: 0,
          isProcessingInput: false
        });

        process.stdout.write("\n");
        this.resetReadline();

      } else if (this.ctrlCCount === 3) {
        await this.logger.info('SHUTDOWN', 'Third interrupt - initiating shutdown');
        console.log('\nExiting...');
        await this.cleanup();
        process.exit(0);
      }
    });
  }

  private setupReadlineHandlers() {
    this.rl.setPrompt('> ');
    this.rl.removeAllListeners('line');

    this.rl.on('line', async (line) => {
      await this.logger.debug('INPUT', 'New input received', {
        inputLength: line.length,
        queueLength: this.inputQueue.length,
        isProcessingInput: this.isProcessingInput,
        readlineState: {
          terminal: this.rl.terminal,
          prompt: this.rl.getPrompt(),
          closed: (this.rl as any).closed
        }
      });

      this.inputQueue.push(line);
      await this.logger.debug('QUEUE', 'Input queued', {
        queueLength: this.inputQueue.length,
        newInput: line
      });

      setImmediate(() => {
        this.processNextInput().catch(async (error) => {
          await this.logger.error('PROCESS', 'Failed to process input', {
            error: error instanceof Error ? error.stack : String(error),
            inputLine: line
          });
        });
      });
    });

    this.rl.on('close', async () => {
      await this.logger.info('READLINE', 'Readline interface closed');
    });

    this.rl.on('pause', async () => {
      await this.logger.debug('READLINE', 'Readline interface paused');
    });

    this.rl.on('resume', async () => {
      await this.logger.debug('READLINE', 'Readline interface resumed');
    });
  }


  private resetReadline() {
    this.logger.debug('READLINE', 'Resetting readline interface', {
      oldState: {
        terminal: this.rl.terminal,
        prompt: this.rl.getPrompt(),
        closed: (this.rl as any).closed
      }
    });

    this.rl.close();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
      terminal: true
    });

    this.setupReadlineHandlers();

    this.logger.debug('READLINE', 'Readline interface reset complete', {
      newState: {
        terminal: this.rl.terminal,
        prompt: this.rl.getPrompt(),
        closed: (this.rl as any).closed
      }
    });

    this.rl.prompt();
  }

  private async processNextInput() {
    if (this.inputQueue.length === 0 || this.isProcessingInput) {
      await this.logger.debug('QUEUE', 'Skipping input processing', {
        queueLength: this.inputQueue.length,
        isProcessingInput: this.isProcessingInput
      });
      return;
    }

    this.isProcessingInput = true;
    const line = this.inputQueue.shift()!;

    try {
      await this.handleLine(line);
    } finally {
      this.isProcessingInput = false;

      await this.logger.debug('QUEUE', 'Completed input processing', {
        remainingQueueLength: this.inputQueue.length,
        isProcessingInput: false
      });

      if (this.inputQueue.length > 0) {
        setImmediate(() => this.processNextInput());
      }
    }
  }

  private async handleLine(line: string) {
    await this.logger.debug('HANDLE', 'Starting line handling', {
      lineLength: line.length,
      readlineState: {
        terminal: this.rl.terminal,
        prompt: this.rl.getPrompt(),
        closed: (this.rl as any).closed
      },
      bufferState: {
        conversationLength: this.conversationBuffer.length,
        lastMessageRole: this.conversationBuffer.length > 0
          ? this.conversationBuffer[this.conversationBuffer.length - 1].role
          : null
      }
    });

    if (!line.trim()) {
      await this.logger.debug('HANDLE', 'Empty line received');
      this.rl.prompt();
      return;
    }

    if (!this.rl.terminal) {
      await this.logger.warn('HANDLE', 'Non-terminal readline detected, resetting', {
        currentTerminal: this.rl.terminal
      });
      this.resetReadline();
      return;
    }

    try {
      if (this.wasInterrupted) {
        await this.logger.info('RECONNECT', 'Reconnecting after interruption', {
          wasInterrupted: true,
          isCurrentlyInterrupted: this.isCurrentlyInterrupted
        });

        this.mcpClient = new MCPClient();
        await this.mcpClient.connect("node", ["dist/server/index.js"]);
        this.agent = await Agent.init(this.mcpClient);

        await this.logger.info('RECONNECT', 'Reconnection successful');
      }

      this.conversationBuffer.push({
        role: 'human',
        text: line
      });

      process.stdout.write("\nAgent: ");

      this.currentAbortController = new AbortController();

      await this.logger.debug('PROCESSING', 'Starting response processing', {
        bufferSize: this.conversationBuffer.length,
        hasAbortController: true
      });

      for await (const event of this.agent.streamResponse(line, this.threadId, {
        signal: this.currentAbortController.signal,
        previousBuffer: this.conversationBuffer
      })) {
        if (this.isCurrentlyInterrupted) {
          await this.logger.info('INTERRUPT', 'Processing interrupted mid-stream', {
            isCurrentlyInterrupted: true,
            wasInterrupted: true
          });

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
      await this.logger.error('HANDLE', 'Error in line handling', {
        error: error instanceof Error ? error.stack : String(error),
        lineContent: line,
        currentState: {
          isInterrupted: this.isCurrentlyInterrupted,
          wasInterrupted: this.wasInterrupted,
          isProcessing: this.isProcessingInput,
          queueLength: this.inputQueue.length
        }
      });

      // Don't rethrow if it's an AbortError
      if (!(error instanceof Error && error.message === 'Aborted')) {
        throw error;
      }

      // Ensure proper cleanup
      this.isProcessingInput = false;
      if (!this.isCurrentlyInterrupted) {
        this.resetReadline();
      }
    } finally {
      this.currentAbortController = null;

      if (!this.isCurrentlyInterrupted) {
        await this.logger.debug('COMPLETION', 'Processing complete', {
          wasInterrupted: false,
          bufferSize: this.conversationBuffer.length
        });

        process.stdout.write("\n");
        this.conversationBuffer = [];
        this.wasInterrupted = false;

        setImmediate(() => {
          this.rl.prompt(true);
        });
      }

      if (!this.isCurrentlyInterrupted) {
        process.stdin.resume();
        this.rl.prompt(true);
      }
    }
  }

  private async cleanup() {
    await this.logger.info('CLEANUP', 'Starting cleanup process', {
      isCurrentlyInterrupted: this.isCurrentlyInterrupted,
      wasInterrupted: this.wasInterrupted,
      isProcessingInput: this.isProcessingInput
    });

    process.stderr.write = this.originalStderr;

    if (this.mcpClient) {
      try {
        await this.mcpClient.disconnect();
        await this.logger.info('CLEANUP', 'MCP client disconnected successfully');
      } catch (error) {
        await this.logger.error('CLEANUP', 'Error during MCP client cleanup', {
          error: error instanceof Error ? error.stack : String(error)
        });
        console.error('Error during MCP client cleanup:', error);
      }
    }

    this.rl.close();
    await this.logger.info('CLEANUP', 'Cleanup complete');
  }
}

// Top-level error handling
process.on('uncaughtException', async (error) => {
  try {
    const logger = Logger.getInstance();
    await logger.error('UNCAUGHT', 'Uncaught exception in main process', {
      error: error.stack || String(error)
    });
  } finally {
    console.error('[ERROR] Uncaught exception:', error);
    process.exit(1);
  }
});

process.on('unhandledRejection', async (error) => {
  try {
    const logger = Logger.getInstance();
    await logger.error('UNHANDLED', 'Unhandled rejection in main process', {
      error: error instanceof Error ? error.stack : String(error)
    });
  } finally {
    console.error('[ERROR] Unhandled rejection:', error);
    process.exit(1);
  }
});

(async () => {
  try {
    // Initialize the logger first
    const logger = await Logger.init();
    await logger.info('STARTUP', 'Starting main process');

    // Create and initialize CLI with the logger
    const cli = new CLI(logger);
    await cli.init();
    await cli.start();
  } catch (error) {
    // Get logger instance for error logging
    const logger = Logger.getInstance();
    await logger.error('STARTUP', 'Error in main process', {
      error: error instanceof Error ? error.stack : String(error)
    });
    console.error('[ERROR] Main process error:', error);
    process.exit(1);
  }
})();
