import { CLITestHarness } from '../../helpers/cli-test-harness';

describe('CLI Input Processing', () => {
  let harness: CLITestHarness;

  beforeEach(() => {
    harness = new CLITestHarness();
    jest.spyOn(harness.cli, 'processNextInput').mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    harness.cleanup();
    jest.restoreAllMocks();
  });

  test('should queue user input', () => {
    harness.sendInput('hello world');
    expect(harness.cli.inputQueue).toContain('hello world');
  });

  test('should handle agent switching command', () => {
    jest.spyOn(harness.mockAgentManager, 'switchAgent');

    harness.sendInput('/switch openai');

    expect(harness.mockAgentManager.switchAgent).toHaveBeenCalledWith('openai');
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
