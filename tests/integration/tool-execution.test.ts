import { CLITestHarness } from '../helpers/cli-test-harness';

describe('CLI Tool Execution Integration', () => {
  let harness: CLITestHarness;

  beforeEach(() => {
    harness = new CLITestHarness();

    // Mock executeTool to return test data
    jest.spyOn(harness.mockMCPClient, 'executeTool').mockImplementation(
      async (name, args) => {
        if (name === 'execute-shell') {
          return {
            content: [
              {
                type: "text",
                text: `Executed: ${args.command}\nOutput: Mock directory listing`
              }
            ]
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Mock execution of ${name}`
            }
          ]
        };
      }
    );
  });

  afterEach(() => {
    harness.cleanup();
    jest.restoreAllMocks();
  });

  test('should properly execute shell commands', async () => {
    // Setup agent to generate a tool call
    harness.mockAgentManager.activeAgent.streamResponse = async function* () {
      yield { type: 'text_delta', content: 'Running command for you.' };
      yield {
        type: 'tool_start',
        tool: {
          name: 'execute-shell',
          id: 'test-tool-id'
        }
      };
      yield {
        type: 'tool_input_delta',
        content: 'ls -la',
        toolId: 'test-tool-id'
      };
      yield {
        type: 'tool_call',
        tool: {
          name: 'execute-shell',
          id: 'test-tool-id',
          args: { command: 'ls -la' }
        }
      };
      yield { type: 'text_delta', content: 'Command complete.' };
    };

    // Send input
    harness.sendInput('run ls -la');

    // Wait for all async operations
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify tool execution
    expect(harness.mockMCPClient.executeTool).toHaveBeenCalledWith(
      'execute-shell',
      { command: 'ls -la' }
    );
  });

  test('should handle tool execution errors', async () => {
    // Make executeTool throw an error
    jest.spyOn(harness.mockMCPClient, 'executeTool').mockRejectedValueOnce(
      new Error('Mock execution error')
    );

    // Setup agent to generate a tool call
    harness.mockAgentManager.activeAgent.streamResponse = async function* () {
      yield { type: 'text_delta', content: 'Running command for you.' };
      yield {
        type: 'tool_call',
        tool: {
          name: 'execute-shell',
          id: 'test-tool-id',
          args: { command: 'invalid command' }
        }
      };
    };

    // Capture error logs
    const errorSpy = jest.spyOn(harness.mockLogger, 'error');

    // Send input
    harness.sendInput('run invalid command');

    // Wait for all async operations
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify error was logged
    expect(errorSpy).toHaveBeenCalled();
  });
});
