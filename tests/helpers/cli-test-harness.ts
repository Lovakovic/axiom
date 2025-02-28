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
