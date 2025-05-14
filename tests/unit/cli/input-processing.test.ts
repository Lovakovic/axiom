import { CLITestHarness } from '../../helpers/cli-test-harness';

describe('CLI Input Processing', () => {
  let harness: CLITestHarness;

  beforeEach(() => {
    harness = new CLITestHarness();
    // Don't mock processNextInput - we want to test the actual queueing behavior
    // jest.spyOn(harness.cli, 'processNextInput').mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    harness.cleanup();
    jest.restoreAllMocks();
  });

  test('should queue user input', async () => {
    // Spy on the queue push operation to verify it happens
    const queueSpy = jest.spyOn(harness.cli.inputQueue, 'push');

    harness.sendInput('hello world');

    // Wait for the next tick to allow the event handler to run
    await new Promise(resolve => setImmediate(resolve));

    // Verify the input was pushed to the queue
    expect(queueSpy).toHaveBeenCalledWith('hello world');
  });

  test('should handle agent switching command', async () => {
    // Make sure we're using the mock agent manager
    harness.cli.agentManager = harness.mockAgentManager;

    // Create the spy after ensuring we're using the right instance
    const switchSpy = jest.spyOn(harness.mockAgentManager, 'switchAgent');

    // Send the command
    harness.sendInput('/switch openai');

    // Wait for the event handler to process the command
    await new Promise(resolve => setImmediate(resolve));

    // Verify the switch was called
    expect(switchSpy).toHaveBeenCalledWith('openai');

    // Command should not be added to the input queue
    expect(harness.cli.inputQueue).not.toContain('/switch openai');
  });

  test('should process inputs sequentially', async () => {
    // Restore the mock to test the real behavior
    jest.restoreAllMocks();

    // Mock handleLine to track calls
    const mockHandleLine = jest.spyOn(harness.cli, 'handleLine')
      .mockImplementation(() => Promise.resolve());

    // Send multiple inputs
    harness.sendInput('first command');
    harness.sendInput('second command');

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Expect handleLine was called with first command
    expect(mockHandleLine).toHaveBeenCalledWith('first command');
  });
});
