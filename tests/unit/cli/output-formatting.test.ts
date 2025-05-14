import { CLITestHarness } from '../../helpers/cli-test-harness';
import { simpleMockResponse, toolCallMockResponse } from '../mocks/mock-stream-events';

// Helper function to wait for a condition to be true
async function waitForCondition(
  condition: () => boolean,
  errorMessage = 'Condition not met in time',
  timeout = 1000,
  interval = 10
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(errorMessage);
}

describe('CLI Output Formatting', () => {
  let harness: CLITestHarness;

  beforeEach(() => {
    harness = new CLITestHarness({
      anthropic: simpleMockResponse,
      openai: toolCallMockResponse
    });
  });

  afterEach(() => {
    harness.cleanup();
    jest.restoreAllMocks();
  });

  test('should format simple text responses correctly', async () => {
    // Mock the activeAgent streamResponse to return our events
    harness.mockAgentManager.activeAgent.streamResponse = async function* () {
      for (const event of simpleMockResponse) {
        yield event;
      }
    };

    // Capture output
    const outputSpy = jest.spyOn(process.stdout, 'write');

    // Send input
    harness.sendInput('tell me about yourself');

    // Wait for the text response to appear in the output
    await waitForCondition(() => {
      const outputCalls = outputSpy.mock.calls.flat().join('');
      return outputCalls.includes('Hello,');
    }, 'Text response never appeared in output');

    // Check for text delta events in output
    expect(outputSpy).toHaveBeenCalledWith('\nAgent: ');

    // Check for specific content in the output
    const outputCalls = outputSpy.mock.calls.flat().join('');
    expect(outputCalls).toContain('Hello,');
  });

  test('should format tool calls correctly', async () => {
    // Use openai which is set to toolCallMockResponse
    harness.mockAgentManager.switchAgent('openai');

    // Mock the activeAgent streamResponse to return our events directly
    harness.mockAgentManager.activeAgent.streamResponse = async function* () {
      for (const event of toolCallMockResponse) {
        yield event;
      }
    };

    // Capture output
    const outputSpy = jest.spyOn(process.stdout, 'write');

    // Send input
    harness.sendInput('list files');

    // Wait for the tool call to appear in the output
    await waitForCondition(() => {
      const outputCalls = outputSpy.mock.calls.flat().join('');
      return outputCalls.includes('execute-shell');
    }, 'Tool call never appeared in output', 1000);

    // Check for tool call events in output
    expect(outputSpy).toHaveBeenCalledWith('\nAgent: ');

    // Verify the tool name appears in the output
    const outputCalls = outputSpy.mock.calls.flat().join('');
    expect(outputCalls).toContain('execute-shell');
  });
});
