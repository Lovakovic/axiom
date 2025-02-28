import { CLITestHarness } from '../../helpers/cli-test-harness';
import { simpleMockResponse, toolCallMockResponse } from '../mocks/mock-stream-events';

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

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check for text delta events in output
    expect(outputSpy).toHaveBeenCalledWith('\nAgent: ');
    expect(outputSpy).toHaveBeenCalledWith('\x1b[33mHello, \x1b[0m');
  });

  test('should format tool calls correctly', async () => {
    // Use openai which is set to toolCallMockResponse
    harness.mockAgentManager.switchAgent('openai');

    // Capture output
    const outputSpy = jest.spyOn(process.stdout, 'write');

    // Send input
    harness.sendInput('list files');

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check for tool call events in output
    expect(outputSpy).toHaveBeenCalledWith('\nAgent: ');
    expect(outputSpy).toHaveBeenCalledWith('\nexecute-shell: ');
  });
});
