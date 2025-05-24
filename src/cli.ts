#!/usr/bin/env node
import readline from 'readline';
import { MCPClient } from "./agent/mcp.client";
import { ILogger, Logger } from './logger';
import { AgentManager } from "./agent/manager";
import { ConversationState } from "./agent/state/conversation.state";
import express from 'express';
import cors from 'cors';
import http from 'http';

const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

const DEFAULT_DEBUG_SERVER_PORT = process.env.DEBUG_SERVER_PORT ? parseInt(process.env.DEBUG_SERVER_PORT, 10) : 3005;

export class CLI {
  private readonly agentManager: AgentManager;
  private mcpClient!: MCPClient;
  private readonly originalStderr: NodeJS.WriteStream['write'];
  private readonly logger: ILogger;

  private ctrlCCount = 0;
  private ctrlCTimeout: NodeJS.Timeout | null = null;
  private isCurrentlyInterrupted = false;
  private wasInterrupted = false;
  private isProcessingInput = false;
  private isReconnecting = false;
  private _reconnectingStartTime: number = 0;

  private readonly inputQueue: string[] = [];
  private currentAbortController: AbortController | null = null;

  private rl: readline.Interface;
  private serverProcess: import('child_process').ChildProcess | null = null;
  private debugServer: http.Server | null = null;
  private actualDebugServerPort: number = DEFAULT_DEBUG_SERVER_PORT;

  constructor(logger: ILogger) {
    this.logger = logger;
    this.agentManager = new AgentManager();

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
    this.initWatchdog();

    setInterval(() => {
      this.logSystemState();
    }, 10000);
  }

  public async init() {
    await this.logger.info('INIT', 'Starting MCP client initialization');

    const { spawn } = require('child_process');
    this.serverProcess = spawn('node', ['dist/server/index.js'], {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.serverProcess?.on('error', async (err) => {
      await this.logger.error('SERVER', 'Server process error', { error: err.message });
    });

    this.serverProcess?.on('exit', async (code) => {
      await this.logger.info('SERVER', 'Server process exited', { code });
      if (code !== 0 && !this.isCurrentlyInterrupted) {
        await this.logger.info('SERVER', 'Attempting to restart server process');
        await this.restartServer();
      }
    });

    this.mcpClient = new MCPClient();
    await this.mcpClient.connect("node", ["dist/server/index.js"]);
    await this.agentManager.init(this.mcpClient);

    if (!this.agentManager.currentAgentKey) {
      const errorMsg = 'No agents available after initialization. CLI cannot operate without an agent.';
      await this.logger.error('INIT', errorMsg);
      console.error(`${YELLOW}Critical: No AI agents could be initialized. Please check your API key configurations (e.g., OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_APPLICATION_CREDENTIALS).${RESET}`);
      console.error(`${YELLOW}Refer to logs for more details. Exiting.${RESET}`);
      await this.cleanup();
      process.exit(1);
    }

    await this.logger.info('INIT', `MCP client and agent manager initialized. Default agent: ${this.agentManager.currentAgentKey}`);
    if (this.logger.isActive()) { // Check if DEBUG is enabled
        await this.startDebugServer(); // Ensure this completes before init() finishes
    } else {
        await this.logger.info('DEBUG_SERVER', 'Debug server not started as DEBUG environment variable is not set appropriately.');
    }
  }

  private async startDebugServer(): Promise<void> {
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.get('/state', (req, res) => {
      const state = ConversationState.getInstance().getDebugState();
      res.json(state);
    });

    app.post('/clear-state', (req, res) => {
      ConversationState.getInstance().clearMessages();
      this.logger.info('DEBUG_SERVER', 'Conversation state cleared via API');
      res.status(200).send({ message: 'Conversation state cleared' });
    });

    app.get('/logs', (req, res) => {
      const logs = Logger.getInstance().getArchivedLogs();
      res.json(logs);
    });

    this.debugServer = http.createServer(app);

    const tryListen = (port: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        const server = this.debugServer!;
        
        // Define handlers specifically for this attempt
        const onError = (error: NodeJS.ErrnoException) => {
          // Remove these specific handlers to prevent them from firing again
          server.removeListener('error', onError);
          server.removeListener('listening', onListening);

          if (error.code === 'EADDRINUSE') {
            this.logger.warn('DEBUG_SERVER', `Port ${port} is in use. Trying a random port.`);
            // Attempt a random port between 1024 and 65535
            const randomPort = Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;
            tryListen(randomPort).then(resolve).catch(reject);
          } else {
            this.logger.error('DEBUG_SERVER', 'Debug server error', { error: error.message });
            reject(error); 
          }
        };

        const onListening = () => {
          // Clean up both handlers once listening is successful
          server.removeListener('error', onError);
          server.removeListener('listening', onListening);

          this.actualDebugServerPort = port;
          this.logger.info('DEBUG_SERVER', `Debug server listening on port ${port}`);
          console.log(`${BLUE}Debugger API up and running!${RESET}`);
          console.log(`${BLUE}  State: http://localhost:${port}/state${RESET}`);
          console.log(`${BLUE}  Logs:  http://localhost:${port}/logs${RESET}`);
          resolve(); 
        };

        // Add the specific handlers for this attempt
        server.on('error', onError);
        server.on('listening', onListening);

        // Attempt to listen
        server.listen(port);
      });
    };
    return tryListen(DEFAULT_DEBUG_SERVER_PORT);
  }

  public async start() {
    this.logger.info('START', 'CLI starting');
    if (!this.agentManager.activeAgent) {
      console.error(`${YELLOW}No active agent available. CLI cannot start interactive mode. Please check configuration and logs.${RESET}`);
      await this.cleanup();
      process.exit(1);
    }
    console.log("Agent ready! Press Ctrl+C once to interrupt, twice to do nothing, three times to exit.");
    console.log(`Current agent: ${this.agentManager.currentAgentKey}`);
    console.log(`To switch models, type: /switch <agent_name> (e.g., /switch openai, /switch claude, /switch gemini)`);
    console.log(`Available configured agents: ${this.agentManager.getAvailableAgentKeys().join(", ") || "None"}`);
    this.rl.prompt();
  }

  private async restartServer() {
    const { spawn } = require('child_process');
    this.serverProcess = spawn('node', ['dist/server/index.js'], {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.reconnect();
  }

  private async reconnect() {
    this._reconnectingStartTime = Date.now();
    this.isReconnecting = true;
    await this.logger.info('RECONNECT', 'Beginning reconnection process', {
      wasInterrupted: this.wasInterrupted,
      isCurrentlyInterrupted: this.isCurrentlyInterrupted,
      isProcessingInput: this.isProcessingInput,
      readlineState: this.getReadlineState()
    });

    try {
      await this.logger.debug('RECONNECT', 'Attempting to disconnect existing client');
      if (this.mcpClient) {
        try {
          await this.mcpClient.disconnect();
          await this.logger.debug('RECONNECT', 'Successfully disconnected old client');
        } catch (error) {
          await this.logger.warn('RECONNECT', 'Error disconnecting old client', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (this.serverProcess) {
        try {
          await this.logger.debug('RECONNECT', 'Terminating existing server process', { pid: this.serverProcess.pid });
          if (this.serverProcess.pid) {
            process.kill(this.serverProcess.pid, 'SIGTERM');
            await new Promise((resolve) => {
              const timeout = setTimeout(() => {
                this.logger.warn('RECONNECT', 'Server termination timeout, forcing kill');
                if (this.serverProcess && this.serverProcess.pid) {
                  try { process.kill(this.serverProcess.pid, 'SIGKILL'); } catch (e) {}
                }
                resolve(null);
              }, 1000);
              if (this.serverProcess) {
                this.serverProcess.once('exit', () => { clearTimeout(timeout); resolve(null); });
              } else { clearTimeout(timeout); resolve(null); }
            });
          }
          await this.logger.debug('RECONNECT', 'Server process terminated');
        } catch (error) {
          await this.logger.warn('RECONNECT', 'Error terminating server process', { error: error instanceof Error ? error.message : String(error) });
        }
        this.serverProcess = null;
      }

      await this.logger.debug('RECONNECT', 'Starting new server process');
      const { spawn } = require('child_process');
      this.serverProcess = spawn('node', ['dist/server/index.js'], {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.serverProcess?.on('error', async (err) => {
        await this.logger.error('RECONNECT', 'New server process error', { error: err.message });
      });
      await this.logger.debug('RECONNECT', 'Waiting for server startup');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await this.logger.debug('RECONNECT', 'Creating new MCP client');
      this.mcpClient = new MCPClient();
      const connectPromise = this.mcpClient.connect("node", ["dist/server/index.js"]);
      const timeoutPromise = new Promise((_, reject) => { setTimeout(() => reject(new Error('Connection timeout')), 5000); });
      try {
        await Promise.race([connectPromise, timeoutPromise]);
        await this.logger.debug('RECONNECT', 'Successfully connected new client');
      } catch (error) {
        await this.logger.error('RECONNECT', 'Connection timeout or error', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }

      await this.logger.debug('RECONNECT', 'Initializing agent manager');
      const initPromise = this.agentManager.init(this.mcpClient);
      const initTimeoutPromise = new Promise((_, reject) => { setTimeout(() => reject(new Error('Agent initialization timeout')), 5000); });
      try {
        await Promise.race([initPromise, initTimeoutPromise]);
        await this.logger.debug('RECONNECT', 'Agent manager initialized successfully');
      } catch (error) {
        await this.logger.error('RECONNECT', 'Agent initialization timeout or error', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }

      await this.logger.info('RECONNECT', 'Reconnection successful', { currentState: this.getCurrentState() });
      this.wasInterrupted = false;
      await this.logger.debug('RECONNECT', 'Reset wasInterrupted flag', { wasInterrupted: this.wasInterrupted });

    } catch (error) {
      await this.logger.error('RECONNECT', 'Reconnection failed', { error: error instanceof Error ? error.stack : String(error), currentState: this.getCurrentState() });
      await this.logger.debug('RECONNECT', 'Setting retry timeout');
      setTimeout(() => this.reconnect(), 2000);
      return;
    } finally {
      this.isReconnecting = false;
      this.isCurrentlyInterrupted = false;
      this._reconnectingStartTime = 0;
      await this.logger.debug('RECONNECT', 'Reconnection process complete, final state', { isReconnecting: this.isReconnecting, isCurrentlyInterrupted: this.isCurrentlyInterrupted, readlineState: this.getReadlineState() });
      process.stdin.resume();
      if (this.rl.terminal && !(this.rl as any).closed) {
        this.rl.prompt();
      } else {
        await this.logger.debug('RECONNECT', 'Readline interface invalid, resetting');
        this.resetReadline();
      }
    }
  }

  private handleSignals() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.on('data', async (data) => {
        if (data.length === 1 && data[0] === 3) { // Ctrl+C
          await this.handleCtrlC();
        }
      });
    }
    process.on('SIGINT', async () => { await this.handleCtrlC(); });
  }

  private async handleCtrlC() {
    const previousCtrlCCount = this.ctrlCCount;
    this.ctrlCCount++;
    await this.logger.info('INTERRUPT', 'Interrupt signal received', { previousCtrlCCount, currentCtrlCCount: this.ctrlCCount, currentState: this.getCurrentState() });

    if (this.ctrlCTimeout) { clearTimeout(this.ctrlCTimeout); this.ctrlCTimeout = null; await this.logger.debug('INTERRUPT', 'Cleared existing Ctrl+C timeout'); }

    if (this.ctrlCCount === 1) {
      const previousFlags = { isCurrentlyInterrupted: this.isCurrentlyInterrupted, wasInterrupted: this.wasInterrupted };
      this.isCurrentlyInterrupted = true;
      this.wasInterrupted = true;
      await this.logger.info('INTERRUPT', 'First interrupt - updating flags', { previous: previousFlags, current: { isCurrentlyInterrupted: this.isCurrentlyInterrupted, wasInterrupted: this.wasInterrupted } });

      if (this.currentAbortController) { await this.logger.debug('INTERRUPT', 'Aborting current controller', { controllerState: this.currentAbortController.signal.aborted ? 'already aborted' : 'active' }); this.currentAbortController.abort(); this.currentAbortController = null; await this.logger.debug('INTERRUPT', 'Controller aborted and set to null'); } else { await this.logger.debug('INTERRUPT', 'No active controller to abort'); }

      this.ctrlCTimeout = setTimeout(() => { const oldCount = this.ctrlCCount; this.ctrlCCount = 0; this.isCurrentlyInterrupted = false; this.logger.info('INTERRUPT', 'Interrupt timeout - resetting flags', { oldCtrlCCount: oldCount, newCtrlCCount: 0, oldInterruptState: true, newInterruptState: false }); }, 1000);
      await this.logger.debug('INTERRUPT', 'Set new Ctrl+C timeout (1000ms)');

      this.inputQueue.length = 0;
      this.isProcessingInput = false;
      await this.logger.debug('INTERRUPT', 'Reset input state', { queueLength: 0, isProcessingInput: false });
      process.stdout.write("\n");
      await this.logger.debug('INTERRUPT', 'About to reset readline', { currentReadlineState: this.getReadlineState() });

      if (!this.isReconnecting) {
        this.resetReadline();
        await this.logger.debug('INTERRUPT', 'After readline reset', { newReadlineState: this.getReadlineState() });
        await this.logger.debug('INTERRUPT', 'Scheduling reconnection');
        setImmediate(async () => { try { await this.reconnect(); } catch (error) { await this.logger.error('INTERRUPT', 'Reconnection failed from interrupt handler', { error: error instanceof Error ? error.stack : String(error) }); } });
      } else { await this.logger.debug('INTERRUPT', 'Already reconnecting, skipping new reconnection'); }

    } else if (this.ctrlCCount === 3) {
      await this.logger.info('SHUTDOWN', 'Third interrupt - initiating shutdown');
      console.log('\nExiting...');
      await this.cleanup();
      process.exit(0);
    } else if (this.ctrlCCount === 2) {
      await this.logger.info('INTERRUPT', 'Second interrupt - no action', { ctrlCCount: this.ctrlCCount });
      this.ctrlCTimeout = setTimeout(() => { const oldCount = this.ctrlCCount; this.ctrlCCount = 0; this.logger.info('INTERRUPT', 'Interrupt timeout - resetting flags after second Ctrl+C', { oldCtrlCCount: oldCount, newCtrlCCount: 0 }); }, 1000);
    }
  }

  private initWatchdog() {
    setInterval(async () => {
      if (this.isReconnecting) {
        const reconnectingTime = this._reconnectingStartTime ? Date.now() - this._reconnectingStartTime : 0;
        if (reconnectingTime > 10000) { // 10 seconds
          await this.logger.warn('WATCHDOG', 'Reconnection taking too long, forcing reset', { reconnectingTime, currentState: this.getCurrentState() });
          this.isReconnecting = false; this.isCurrentlyInterrupted = false; this.isProcessingInput = false; this._reconnectingStartTime = 0;
          await this.cleanupServerProcess();
          this.resetReadline();
        }
      }
    }, 5000);
  }

  private async logSystemState() {
    await this.logger.debug('SYSTEM_STATE', 'Periodic system state check', {
      ...this.getCurrentState(),
      processInfo: { uptime: process.uptime(), memory: process.memoryUsage(), stdin: { isRaw: process.stdin.isRaw, isTTY: process.stdin.isTTY }, stdout: { isTTY: process.stdout.isTTY } }
    });
  }

  private setupReadlineHandlers() {
    this.rl.setPrompt('> ');
    this.rl.removeAllListeners('line');
    this.rl.on('line', async (line) => {
      await this.logger.debug('INPUT', 'New input received', { inputLength: line.length, queueLength: this.inputQueue.length, isProcessingInput: this.isProcessingInput, readlineState: this.getReadlineState() });
      const trimmed = line.trim();
      if (trimmed.startsWith("/switch ")) {
        const newAgent = trimmed.substring(8).trim().toLowerCase();
        const switchMsg = this.agentManager.switchAgent(newAgent);
        console.log(YELLOW + switchMsg + RESET);
        if (this.agentManager.currentAgentKey === newAgent) { console.log(`Current agent: ${this.agentManager.currentAgentKey}`); }
        this.rl.prompt();
        return;
      }
      this.inputQueue.push(line);
      await this.logger.debug('QUEUE', 'Input queued', { queueLength: this.inputQueue.length, newInput: line });
      setImmediate(() => { this.processNextInput().catch(async (error) => { await this.logger.error('PROCESS', 'Failed to process input', { error: error instanceof Error ? error.stack : String(error), inputLine: line }); }); });
    });
    this.rl.on('close', async () => { await this.logger.info('READLINE', 'Readline interface closed'); });
    this.rl.on('pause', async () => { await this.logger.debug('READLINE', 'Readline interface paused'); });
    this.rl.on('resume', async () => { await this.logger.debug('READLINE', 'Readline interface resumed'); });
  }

  private resetReadline() {
    this.logger.debug('READLINE', 'Resetting readline interface', { oldState: this.getReadlineState() });
    try { if (this.rl && !(this.rl as any).closed) { this.rl.close(); } } catch (error) { this.logger.warn('READLINE', 'Error closing readline', { error: error instanceof Error ? error.message : String(error) }); }
    try {
      this.rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ', terminal: true });
      this.setupReadlineHandlers();
      this.logger.debug('READLINE', 'Readline interface reset complete', { newState: this.getReadlineState() });
    } catch (error) {
      this.logger.error('READLINE', 'Failed to create new readline interface', { error: error instanceof Error ? error.stack : String(error) });
      try {
        this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        this.rl.setPrompt('> ');
        this.rl.on('line', (line) => { this.logger.debug('READLINE', 'Fallback readline received input', { input: line }); this.inputQueue.push(line); setImmediate(() => this.processNextInput()); });
      } catch (e) { this.logger.error('READLINE', 'Critical failure in readline reset', { error: e instanceof Error ? e.stack : String(e) }); }
    }
    try { this.rl.prompt(); } catch (error) { this.logger.error('READLINE', 'Error prompting after reset', { error: error instanceof Error ? error.message : String(error) }); }
  }

  private getReadlineState() {
    return {
      terminal: this.rl.terminal, prompt: this.rl.getPrompt(), closed: (this.rl as any).closed, line: (this.rl as any).line, cursor: (this.rl as any).cursor, _events: Object.keys((this.rl as any)._events || {}),
      listeners: { line: this.rl.listenerCount('line'), close: this.rl.listenerCount('close'), pause: this.rl.listenerCount('pause'), resume: this.rl.listenerCount('resume') }
    };
  }

  private getCurrentState() {
    return {
      ctrlCCount: this.ctrlCCount, isCurrentlyInterrupted: this.isCurrentlyInterrupted, wasInterrupted: this.wasInterrupted, isProcessingInput: this.isProcessingInput, isReconnecting: this.isReconnecting,
      queueLength: this.inputQueue.length, hasAbortController: this.currentAbortController !== null, readlineState: this.getReadlineState()
    };
  }

  private async processNextInput() {
    await this.logger.debug('QUEUE', 'processNextInput called', { currentState: this.getCurrentState() });
    if (this.inputQueue.length === 0 || this.isProcessingInput || this.isReconnecting) {
      await this.logger.debug('QUEUE', 'Skipping input processing', { reason: this.inputQueue.length === 0 ? 'empty queue' : this.isProcessingInput ? 'already processing' : 'reconnecting', currentState: this.getCurrentState() });
      if (this.isReconnecting && this.inputQueue.length > 0) { process.stdout.write("\nPlease wait, reconnecting to server...\n"); }
      return;
    }
    this.isProcessingInput = true;
    const line = this.inputQueue.shift()!;
    await this.logger.debug('QUEUE', 'Processing input', { inputLine: line, queueLength: this.inputQueue.length });
    try {
      await this.logger.debug('HANDLE', 'Before handleLine call', { readlineState: this.getReadlineState() });
      await this.handleLine(line);
      await this.logger.debug('HANDLE', 'After handleLine call', { readlineState: this.getReadlineState() });
    } catch (error) { await this.logger.error('PROCESS', 'Error in processNextInput', { error: error instanceof Error ? error.stack : String(error), currentState: this.getCurrentState() });
    } finally {
      this.isProcessingInput = false;
      await this.logger.debug('QUEUE', 'Completed input processing', { remainingQueueLength: this.inputQueue.length, isProcessingInput: false, currentState: this.getCurrentState() });
      if (this.inputQueue.length > 0) { await this.logger.debug('QUEUE', 'Scheduling next input processing'); setImmediate(() => this.processNextInput()); }
    }
  }

  private async handleLine(line: string) {
    await this.logger.debug('HANDLE', 'handleLine called', { lineContent: line, lineLength: line.length, currentState: this.getCurrentState() });
    if (!line.trim()) { await this.logger.debug('HANDLE', 'Empty line received'); this.rl.prompt(); return; }
    if (!this.rl.terminal) { await this.logger.warn('HANDLE', 'Non-terminal readline detected, resetting', { currentReadlineState: this.getReadlineState() }); this.resetReadline(); return; }
    const activeAgent = this.agentManager.activeAgent;
    if (!activeAgent) { await this.logger.error('HANDLE', 'No active agent to handle line. This should not happen if init was successful.'); console.log(`${YELLOW}Error: No active agent. Cannot process input. Please check logs and configuration.${RESET}`); this.rl.prompt(); return; }

    try {
      process.stdout.write("\nAgent: ");
      this.currentAbortController = new AbortController();
      await this.logger.debug('HANDLE', 'Created new AbortController', { signal: { aborted: this.currentAbortController.signal.aborted, reason: this.currentAbortController.signal.reason } });
      let toolEventOccurred = false;
      await this.logger.debug('HANDLE', 'Before streaming agent response');
      for await (const event of activeAgent.streamResponse(line, { signal: this.currentAbortController.signal })) {
        if (this.isCurrentlyInterrupted) { await this.logger.info('INTERRUPT', 'Processing interrupted mid-stream', { isCurrentlyInterrupted: true, wasInterrupted: true, eventType: event.type }); this.isProcessingInput = false; process.stdout.write("\n"); break; }
        if (Math.random() < 0.05) { await this.logger.debug('STREAM', 'Stream event received', { eventType: event.type, contentLength: 'content' in event ? (event.content?.length || 0) : 0 }); }
        switch (event.type) {
          case 'tool_start': { if(event.tool.name) { process.stdout.write("\n" + BLUE + event.tool.name + ": " + RESET); toolEventOccurred = true; } break; }
          case 'tool_input_delta': { process.stdout.write(BLUE + (event.content || "") + RESET); toolEventOccurred = true; break; }
          case 'text_delta': { if (toolEventOccurred) { process.stdout.write("\n"); toolEventOccurred = false; } process.stdout.write(YELLOW + event.content + RESET); break; }
        }
      }
      await this.logger.debug('HANDLE', 'Completed streaming agent response');
    } catch (error) {
      await this.logger.error('HANDLE', 'Error in line handling', { error: error instanceof Error ? error.stack : String(error), lineContent: line, currentState: this.getCurrentState() });
      if (!(error instanceof Error && error.message === 'Aborted')) {
        if (error instanceof Error && (error.message.includes('Connection closed') || error.message.includes('connection') || error.message.includes('ECONNREFUSED'))) {
          await this.logger.info('HANDLE', 'Connection error detected, triggering reconnection');
          if (!this.isReconnecting) { setImmediate(() => this.reconnect()); }
        } else { throw error; }
      }
      this.isProcessingInput = false;
      if (!this.isCurrentlyInterrupted && !this.isReconnecting) { await this.logger.debug('HANDLE', 'Resetting readline after error'); this.resetReadline(); }
    } finally {
      await this.logger.debug('HANDLE', 'In finally block, cleaning up', { currentAbortController: this.currentAbortController !== null, currentState: this.getCurrentState() });
      this.currentAbortController = null;
      if (!this.isCurrentlyInterrupted && !this.isReconnecting) {
        await this.logger.debug('COMPLETION', 'Processing complete', { wasInterrupted: false, isReconnecting: false });
        process.stdout.write("\n");
        setImmediate(() => { this.rl.prompt(true); });
      }
      if (!this.isCurrentlyInterrupted && !this.isReconnecting) { process.stdin.resume(); this.rl.prompt(true); await this.logger.debug('HANDLE', 'Prompted for next input'); }
    }
  }

  private async cleanupServerProcess() {
    if (!this.serverProcess) { return; }
    await this.logger.debug('SERVER', 'Cleaning up server process', { pid: this.serverProcess.pid });
    try {
      if (this.serverProcess.pid) {
        process.kill(this.serverProcess.pid, 'SIGTERM');
        const terminated = await Promise.race([ new Promise<boolean>(resolve => { this.serverProcess?.once('exit', () => resolve(true)); }), new Promise<boolean>(resolve => { setTimeout(() => resolve(false), 1000); }) ]);
        if (!terminated && this.serverProcess.pid) { await this.logger.warn('SERVER', 'Forcing server process termination'); process.kill(this.serverProcess.pid, 'SIGKILL'); }
      }
    } catch (error) { await this.logger.warn('SERVER', 'Error terminating server process', { error: error instanceof Error ? error.message : String(error) });
    } finally { this.serverProcess = null; }
  }

  private async cleanup() {
    await this.logger.info('CLEANUP', 'Starting cleanup process', { isCurrentlyInterrupted: this.isCurrentlyInterrupted, wasInterrupted: this.wasInterrupted, isProcessingInput: this.isProcessingInput, isReconnecting: this.isReconnecting });
    process.stderr.write = this.originalStderr;
    if (this.ctrlCTimeout) { clearTimeout(this.ctrlCTimeout); this.ctrlCTimeout = null; }
    if (this.mcpClient) { try { await this.mcpClient.disconnect(); await this.logger.info('CLEANUP', 'MCP client disconnected successfully'); } catch (error) { await this.logger.error('CLEANUP', 'Error during MCP client cleanup', { error: error instanceof Error ? error.stack : String(error) }); } }
    await this.cleanupServerProcess();

    if (this.debugServer) {
      await new Promise<void>((resolve, reject) => {
        this.debugServer!.close((err) => {
          if (err) { this.logger.error('DEBUG_SERVER', 'Error closing debug server', { error: err.message }); reject(err); }
          else { this.logger.info('DEBUG_SERVER', 'Debug server closed'); resolve(); }
        });
      });
    }

    try { if (this.rl && !(this.rl as any).closed) { this.rl.close(); } } catch (error) { await this.logger.warn('CLEANUP', 'Error closing readline', { error: error instanceof Error ? error.message : String(error) }); }
    await this.logger.info('CLEANUP', 'Cleanup complete');
  }
}

process.on('uncaughtException', async (error) => {
  try { const logger = Logger.getInstance(); await logger.error('UNCAUGHT', 'Uncaught exception in main process', { error: error.stack ?? String(error) }); } finally { console.error('[ERROR] Uncaught exception:', error); process.exit(1); }
});
process.on('unhandledRejection', async (error) => {
  try { const logger = Logger.getInstance(); await logger.error('UNHANDLED', 'Unhandled rejection in main process', { error: error instanceof Error ? error.stack : String(error) }); } finally { console.error('[ERROR] Unhandled rejection:', error); process.exit(1); }
});

if (require.main === module) {
  (async () => {
    let logger: Logger | null = null;
    try {
      logger = await Logger.init();
      await logger.info('STARTUP', 'Starting main process');
      const cli = new CLI(logger);
      await cli.init(); // init() will now wait for startDebugServer (if active) to complete
      await cli.start();
    } catch (error) {
      if (logger && logger.isActive()) { await logger.error('STARTUP', 'Error in main process', { error: error instanceof Error ? error.stack : String(error) }); }
      else { console.error('[ERROR] Main process error (logging might be disabled):', error); }
      process.exit(1);
    }
  })();
}

