#!/usr/bin/env node
import readline from 'readline';
import { MCPClient } from "./agent/client";
import { Logger } from './logger';
import { AgentManager } from "./agent/manager";  // Using AgentManager instead of single Agent

const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

interface ConversationMessage {
  role: 'human' | 'ai';
  text: string;
}

export class CLI {
  private readonly threadId: string;
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
  private rl: readline.Interface;
  private conversationBuffer: ConversationMessage[] = [];

  constructor(threadId: string, logger: Logger) {
    this.threadId = threadId;
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
    await this.logger.info('INIT', 'Initializing CLI', {
      threadId: this.threadId
    });

    await this.logger.info('INIT', 'Starting MCP client initialization');
    this.mcpClient = new MCPClient();
    await this.mcpClient.connect("node", ["dist/server/index.js"]);

    // Initialize the AgentManager with both providers
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

        // Abort any ongoing requests if needed
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

  // Updated handleLine to include switch command logic and usage of active agent.
  // Also wraps each output with yellow color and ensures output ends with a newline.
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

    // Check if the user wants to switch agents. Command: "/switch openai" or "/switch anthropic"
    const trimmed = line.trim();
    if (trimmed.startsWith("/switch ")) {
      const newAgent = trimmed.substring(8).trim().toLowerCase();
      const switchMsg = this.agentManager.switchAgent(newAgent);
      console.log(YELLOW + switchMsg + RESET);
      this.rl.prompt();
      return;
    }

    // Normal conversation: add human message to conversationBuffer
    this.conversationBuffer.push({
      role: 'human',
      text: line
    });

    // Invoke the active agent's streamResponse using the conversationBuffer and threadId
    let lastChunk = "";
    try {
      for await (const event of this.agentManager.activeAgent.streamResponse(
        line,
        this.threadId,
        { previousBuffer: this.conversationBuffer }
      )) {
        if (event.type === "text") {
          // Wrap the output in yellow for consistency
          process.stdout.write(YELLOW + event.content + RESET);
          lastChunk = event.content;
        }
        // Additional event types like tool_start or tool_input can be handled here if needed
      }
      // If the last chunk doesn't end with a newline, add one to avoid overwriting by the prompt.
      if (!lastChunk.endsWith("\n")) {
        process.stdout.write("\n");
      }
      // After completion, prompt for the next input:
      this.rl.prompt();
    } catch (err) {
      console.error("Error during agent response:", err);
      this.rl.prompt();
    }
  }

  // Optional cleanup
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

    const threadId = Math.random().toString(36).substring(7);

    const cli = new CLI(threadId, logger);
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
