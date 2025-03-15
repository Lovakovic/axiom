import { CLITestHarness, EnhancedCLITestHarness } from '../helpers/cli-test-harness';
import { simpleMockResponse } from '../unit/mocks/mock-stream-events';

describe('CLI Multiple Interrupts Handling', () => {
  let harness: EnhancedCLITestHarness;

  beforeEach(() => {
    harness = new EnhancedCLITestHarness();

    // Mock streamResponse to simulate long-running responses
    harness.mockAgentManager.activeAgent.streamResponse = jest.fn(async function* (input: any) {
      yield { type: 'text_delta', content: 'Starting to respond...' };

      // Add a delay to simulate a long-running response
      await new Promise(resolve => setTimeout(resolve, 100));

      if (!this.interrupted) {
        for (const event of simpleMockResponse) {
          yield event;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    });
  });

  afterEach(() => {
    harness.cleanup();
    jest.restoreAllMocks();
  });

  test('should detect unresponsive state after multiple interrupts', async () => {
    // First sequence: input -> interrupt
    harness.sendInput('first command');
    await new Promise(resolve => setTimeout(resolve, 50));
    harness.sendCtrlC();
    await new Promise(resolve => setTimeout(resolve, 200)); // Wait for interrupt to process

    // CLI should still be responsive after first interrupt
    expect(harness.isResponsive()).toBe(true);

    // Send second input and interrupt
    harness.sendInput('second command');
    await new Promise(resolve => setTimeout(resolve, 50));
    harness.sendCtrlC();
    await new Promise(resolve => setTimeout(resolve, 200)); // Wait for second interrupt

    // Check if CLI is unresponsive after the second interrupt
    // In the buggy implementation, this would be false
    expect(harness.isResponsive()).toBe(false);

    // Try to send third command - in the broken implementation this wouldn't work
    const streamResponseSpy = harness.mockAgentManager.activeAgent.streamResponse;
    streamResponseSpy.mockClear(); // Clear previous calls

    harness.sendInput('third command');
    await new Promise(resolve => setTimeout(resolve, 100));

    // In the buggy implementation, the third command wouldn't reach the agent
    expect(streamResponseSpy).not.toHaveBeenCalled();
  });

  test('should fail to exit application after multiple Ctrl+C across commands', async () => {
    // Spy on cleanup and process.exit
    const cleanupSpy = jest.spyOn(harness.cli, 'cleanup');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // First command and interrupt
    harness.sendInput('first command');
    await new Promise(resolve => setTimeout(resolve, 50));
    harness.sendCtrlC();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Second command and interrupt
    harness.sendInput('second command');
    await new Promise(resolve => setTimeout(resolve, 50));
    harness.sendCtrlC();
    await new Promise(resolve => setTimeout(resolve, 200));

    // At this point, harness should be unresponsive in the buggy implementation
    expect(harness.isResponsive()).toBe(false);

    // Now try multiple Ctrl+C to exit
    cleanupSpy.mockClear();
    exitSpy.mockClear();

    harness.sendCtrlC();
    await new Promise(resolve => setTimeout(resolve, 50));
    harness.sendCtrlC();
    await new Promise(resolve => setTimeout(resolve, 50));
    harness.sendCtrlC();
    await new Promise(resolve => setTimeout(resolve, 100));

    // In the broken implementation, the cleanup and exit wouldn't be called
    // after the unresponsive state
    expect(cleanupSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
