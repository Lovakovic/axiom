import { CLITestHarness } from '../helpers/cli-test-harness';
import { simpleMockResponse, toolCallMockResponse } from '../unit/mocks/mock-stream-events';

describe('CLI I/O Flow Integration', () => {
  let harness: CLITestHarness;

  beforeEach(() => {
    harness = new CLITestHarness({
      anthropic: simpleMockResponse,
      openai: toolCallMockResponse
    });
  });

  afterEach(() => {
    harness.cleanup();
  });

  test('should process a complete I/O cycle with text response', async () => {
    // Setup a real-like stream response
    harness.mockAgentManager.activeAgent.streamResponse = async function* (input: any) {
      expect(input).toBe('hello assistant');

      // Yield our mocked stream events
      for (const event of simpleMockResponse) {
        yield event;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };

    // Capture output
    const outputSpy = jest.spyOn(process.stdout, 'write');

    // Send input
    harness.sendInput('hello assistant');

    // Wait for all async operations
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify output
    expect(outputSpy).toHaveBeenCalledWith('\nAgent: ');

    // Verify prompt is shown after completion
    expect(outputSpy).toHaveBeenCalledWith('\n');
  });

  test('should process a complete I/O cycle with tool call', async () => {
    // Switch to openai agent
    harness.mockAgentManager.switchAgent('openai');

    // Capture output
    const outputSpy = jest.spyOn(process.stdout, 'write');

    // Send input
    harness.sendInput('list my files');

    // Wait for all async operations
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify tool call formatting
    const outputCalls = outputSpy.mock.calls.flat().join('');

    // Check for key parts of the output
    expect(outputCalls).toContain('Agent: ');
    expect(outputCalls).toContain('execute-shell');
  });
});
