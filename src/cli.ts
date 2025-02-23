#!/usr/bin/env node
import readline from 'readline';
import {MCPClient} from "./agent/mcp.client";
import {Logger} from './logger';
import {AgentManager} from "./agent/manager";

const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

export class CLI {
  private agentManager!: AgentManager;
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

  private rl: readline.Interface;

  constructor(logger: Logger) {
    this.logger = logger;

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
    await this.logger.info('INIT', 'Starting MCP client initialization');
    this.mcpClient = new MCPClient();
    await this.mcpClient.connect("node", ["dist/server/index.js"]);

    // Initialize AgentManager with both providers
    this.agentManager = new AgentManager();
    await this.agentManager.init(this.mcpClient);

    await this.logger.info('INIT', 'MCP client and agent manager initialized successfully');
  }

  public async start() {
    this.logger.info('START', 'CLI starting');
    console.log("Agent ready! Press Ctrl+C once to interrupt, twice to do nothing, three times to exit.");
    console.log(`Current agent: ${this.agentManager.currentAgentKey}`);
    console.log("To switch models, type: /switch openai  OR  /switch anthropic");
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

        // Abort any ongoing requests
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

      // Check for model switching command
      const trimmed = line.trim();
      if (trimmed.startsWith("/switch ")) {
        const newAgent = trimmed.substring(8).trim().toLowerCase();
        const switchMsg = this.agentManager.switchAgent(newAgent);
        console.log(YELLOW + switchMsg + RESET);
        this.rl.prompt();
        return;
      }

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
    if (!line.trim()) {
      await this.logger.debug('HANDLE', 'Empty line received');
      this.rl.prompt();
      return;
    }

    if (!this.rl.terminal) {
      await this.logger.warn('HANDLE', 'Non-terminal readline detected, resetting', { currentTerminal: this.rl.terminal });
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
        await this.agentManager.init(this.mcpClient);

        await this.logger.info('RECONNECT', 'Reconnection successful');
      }

      process.stdout.write("\nAgent: ");

      this.currentAbortController = new AbortController();

      let toolEventOccurred = false;
      for await (const event of this.agentManager.activeAgent.streamResponse(
        line,
        { signal: this.currentAbortController.signal }
      )) {
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
          case 'tool_start': {
            if(event.tool.name) {
              process.stdout.write("\n" + BLUE + event.tool.name + ": " + RESET);
              toolEventOccurred = true;
            }
            break;
          }
          case 'tool_input_delta': {
            // Append a newline after tool input to separate from subsequent agent output
            process.stdout.write(BLUE + (event.content || "") + RESET);
            toolEventOccurred = true;
            break;
          }
          case 'text_delta': {
            if (toolEventOccurred) {
              process.stdout.write("\n");
              toolEventOccurred = false;
            }
            process.stdout.write(YELLOW + event.content + RESET);
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

      if (!(error instanceof Error && error.message === 'Aborted')) {
        throw error;
      }

      this.isProcessingInput = false;
      if (!this.isCurrentlyInterrupted) {
        this.resetReadline();
      }
    } finally {
      this.currentAbortController = null;
      if (!this.isCurrentlyInterrupted) {
        await this.logger.debug('COMPLETION', 'Processing complete', {
          wasInterrupted: false,
        });
        process.stdout.write("\n");
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

process.on('uncaughtException', async (error) => {
  try {
    const logger = Logger.getInstance();
    await logger.error('UNCAUGHT', 'Uncaught exception in main process', {
      error: error.stack ?? String(error)
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
    const logger = await Logger.init();
    await logger.info('STARTUP', 'Starting main process');

    const cli = new CLI(logger);
    await cli.init();
    await cli.start();
  } catch (error) {
    const logger = Logger.getInstance();
    await logger.error('STARTUP', 'Error in main process', {
      error: error instanceof Error ? error.stack : String(error)
    });
    console.error('[ERROR] Main process error:', error);
    process.exit(1);
  }
})();
