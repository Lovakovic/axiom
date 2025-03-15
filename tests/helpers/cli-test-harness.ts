import { EventEmitter } from 'events';
import { CLI } from '../../src/cli';
import { MockMCPClient } from '../unit/mocks/mock-mcp-client';
import { MockAgent, MockAgentManager } from '../unit/mocks/mock-agent';
import { simpleMockResponse } from '../unit/mocks/mock-stream-events';
import { ILogger } from "../../src/logger";

// Ensure required environment variables are set for tests
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'dummy-openai-key';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'dummy-anthropic-key';

// Create a MockStdin that extends EventEmitter so it supports .on, etc.
class MockStdin extends EventEmitter {
  resume = jest.fn();
  pause = jest.fn();
  setRawMode = jest.fn();
}

// Create a MockStdout that extends EventEmitter so that it has .on (needed for 'resize')
class MockStdout extends EventEmitter {
  write = jest.fn().mockImplementation(() => true);
}

// Updated MockProcess with proper stdin and stdout mocks
class MockProcess extends EventEmitter {
  stderr = {
    write: jest.fn().mockImplementation(() => true)
  };

  stdout = new MockStdout();

  stdin = new MockStdin();

  exit = jest.fn();

  // Send SIGINT signal
  sendSigInt() {
    this.emit('SIGINT');
  }
}

// Mock Readline interface that your CLI uses for its user interaction.
class MockReadline extends EventEmitter {
  output: string[] = [];
  closed = false;

  setPrompt() {}
  prompt() {}

  write(data: string) {
    this.output.push(data);
    return true;
  }

  close() {
    this.closed = true;
    this.emit('close');
  }

  getPrompt() {
    return '> ';
  }

  terminal = true;

  sendLine(line: string) {
    this.emit('line', line);
  }

  getOutput() {
    return this.output.join('');
  }
}

// Extended MockReadline that can simulate becoming unresponsive
class ExtendedMockReadline extends MockReadline {
  isAcceptingInput = true;

  // Override sendLine to simulate unresponsiveness
  sendLine(line: string) {
    if (!this.isAcceptingInput) {
      console.log('MockReadline is unresponsive, ignoring input:', line);
      return;
    }
    super.sendLine(line);
  }

  // Method to simulate the readline becoming unresponsive
  makeUnresponsive() {
    this.isAcceptingInput = false;
  }

  // Method to restore responsiveness
  makeResponsive() {
    this.isAcceptingInput = true;
  }

  // Track the state when readline is reset
  close() {
    super.close();
    // In the real CLI, if there's a bug in the reset logic,
    // the new readline instance might not correctly accept input
  }
}

// A simple mock logger that collects log messages.
export class MockLogger implements ILogger {
  logs: any[] = [];
  private static instance: MockLogger;

  async info(category: string, message: string, metadata?: Record<string, any>): Promise<void> {
    this.logs.push({ level: 'INFO', category, message, metadata });
  }

  async debug(category: string, message: string, metadata?: Record<string, any>): Promise<void> {
    this.logs.push({ level: 'DEBUG', category, message, metadata });
  }

  async warn(category: string, message: string, metadata?: Record<string, any>): Promise<void> {
    this.logs.push({ level: 'WARN', category, message, metadata });
  }

  async error(category: string, message: string, metadata?: Record<string, any>): Promise<void> {
    this.logs.push({ level: 'ERROR', category, message, metadata });
  }

  static getInstance(): ILogger {
    if (!MockLogger.instance) {
      MockLogger.instance = new MockLogger();
    }
    return MockLogger.instance;
  }

  static async init(): Promise<ILogger> {
    return MockLogger.getInstance();
  }
}

// The updated CLITestHarness that sets up the CLI using our mocks.
export class CLITestHarness {
  cli: any;
  mockMCPClient: MockMCPClient;
  mockAgentManager: MockAgentManager;
  mockReadline: MockReadline;
  mockLogger: MockLogger;
  mockProcess: MockProcess;
  originalProcess: any;

  constructor(mockResponses = {
    anthropic: simpleMockResponse,
    openai: simpleMockResponse
  }) {
    // Save original global process
    this.originalProcess = global.process;

    // Set up mocks
    this.mockReadline = new MockReadline();
    this.mockMCPClient = new MockMCPClient();

    // Create mock agents for anthropic and openai
    const mockAnthropicAgent = new MockAgent(mockResponses.anthropic);
    const mockOpenAIAgent = new MockAgent(mockResponses.openai);

    this.mockAgentManager = new MockAgentManager({
      anthropic: mockAnthropicAgent,
      openai: mockOpenAIAgent
    });

    this.mockLogger = MockLogger.getInstance() as MockLogger;
    this.mockProcess = new MockProcess();

    // Replace global process with our mock to supply proper stdin and stdout.
    global.process = this.mockProcess as any;

    // Create the CLI instance with our mock logger
    this.cli = new CLI(this.mockLogger);

    // Inject our mocks into the CLI instance
    this.cli.rl = this.mockReadline;
    this.cli.mcpClient = this.mockMCPClient;
    this.cli.agentManager = this.mockAgentManager;

    // Override resetReadline to reuse our mockReadline instead of creating a new interface
    this.cli.resetReadline = () => {
      this.cli.rl = this.mockReadline;
      this.mockReadline.prompt();
    };

    // Set up the readline handlers on the CLI instance
    this.cli.setupReadlineHandlers();
  }

  // Cleanup after tests: restore the original process
  cleanup() {
    global.process = this.originalProcess;
  }

  // Utility to simulate user input
  sendInput(line: string) {
    this.mockReadline.sendLine(line);
  }

  // Utility to get the CLI output
  getOutput() {
    return this.mockReadline.getOutput();
  }

  // Utility to simulate Ctrl+C input
  sendCtrlC() {
    this.mockProcess.sendSigInt();
  }
}

// Enhanced CLITestHarness that can check for unresponsiveness
export class EnhancedCLITestHarness extends CLITestHarness {
  enhancedMockReadline: ExtendedMockReadline;

  constructor(mockResponses = {
    anthropic: simpleMockResponse,
    openai: simpleMockResponse
  }) {
    super(mockResponses);

    // Replace the standard mockReadline with our enhanced version
    this.enhancedMockReadline = new ExtendedMockReadline();
    this.mockReadline = this.enhancedMockReadline;
    this.cli.rl = this.enhancedMockReadline;

    // Override the resetReadline method to simulate what happens in the real CLI
    this.cli.resetReadline = () => {
      // In the buggy implementation, after certain interrupt sequences
      // the readline might become unresponsive
      if (this.cli.ctrlCCount > 1 && this.cli.wasInterrupted && this.cli.isCurrentlyInterrupted) {
        console.log('Simulating buggy behavior: Readline becomes unresponsive after multiple interrupts');
        this.enhancedMockReadline.makeUnresponsive();
      } else {
        this.enhancedMockReadline.makeResponsive();
      }

      // Log the simulated readline reset
      console.log('Simulated readline reset with state:', {
        ctrlCCount: this.cli.ctrlCCount,
        wasInterrupted: this.cli.wasInterrupted,
        isCurrentlyInterrupted: this.cli.isCurrentlyInterrupted,
        isReconnecting: this.cli.isReconnecting
      });

      this.enhancedMockReadline.prompt();
    };

    // More accurately track the actual CLI's state when handling interrupts
    const originalHandleSignals = this.cli.handleSignals;
    this.cli.handleSignals = () => {
      originalHandleSignals.call(this.cli);

      // Replace the SIGINT handler with one that more accurately models the bug
      process.removeAllListeners('SIGINT');
      process.on('SIGINT', async () => {
        this.cli.ctrlCCount++;

        if (this.cli.ctrlCCount === 1) {
          this.cli.isCurrentlyInterrupted = true;
          this.cli.wasInterrupted = true;

          // Clear timeout if it exists
          if (this.cli.ctrlCTimeout) {
            clearTimeout(this.cli.ctrlCTimeout);
          }

          // Set a timeout to reset the counter - this part might be buggy
          this.cli.ctrlCTimeout = setTimeout(() => {
            this.cli.ctrlCCount = 0;
          }, 1000);

          // Abort current controller if it exists
          if (this.cli.currentAbortController) {
            this.cli.currentAbortController.abort();
            this.cli.currentAbortController = null;
          }

          this.cli.inputQueue.length = 0;
          this.cli.isProcessingInput = false;

          process.stdout.write("\n");
          this.cli.resetReadline();

        } else if (this.cli.ctrlCCount === 3) {
          console.log('\nExiting...');
          await this.cli.cleanup();
          process.exit(0);
        } else {
          // This is where the bug might be - nothing happens on count 2,
          // but the state remains inconsistent
          console.log(`Ctrl+C pressed ${this.cli.ctrlCCount} times`);
        }
      });
    };

    // Call handleSignals to set up our improved handler
    this.cli.handleSignals();
  }

  // Enhanced method to check if the CLI is in a responsive state
  isResponsive() {
    return this.enhancedMockReadline.isAcceptingInput;
  }
}
