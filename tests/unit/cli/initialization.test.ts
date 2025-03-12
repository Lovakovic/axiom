import { CLITestHarness } from '../../helpers/cli-test-harness';

describe('CLI Initialization', () => {
  let harness: CLITestHarness;

  beforeEach(() => {
    harness = new CLITestHarness();
  });

  afterEach(() => {
    harness.cleanup();
  });

  test('should initialize readline interface', async () => {
    expect(harness.cli.rl).toBeDefined();
    expect(harness.cli.rl.terminal).toBe(true);
  });

  test('should setup signal handlers', async () => {
    expect(harness.cli.ctrlCCount).toBe(0);
    expect(harness.cli.isCurrentlyInterrupted).toBe(false);

    // Spy on the logger method that gets called when interrupt is processed
    const loggerSpy = jest.spyOn(harness.mockLogger, 'info');

    harness.sendCtrlC();

    // Wait for the specific log message that indicates interrupt processing is complete
    await new Promise<void>(resolve => {
      const checkLogs = () => {
        const interruptLogs = loggerSpy.mock.calls.filter(
          call => call[0] === 'INTERRUPT' && call[1] === 'First interrupt - updating flags'
        );

        if (interruptLogs.length > 0) {
          resolve();
        } else {
          setTimeout(checkLogs, 10);
        }
      };
      checkLogs();
    });

    expect(harness.cli.ctrlCCount).toBe(1);
    expect(harness.cli.isCurrentlyInterrupted).toBe(true);
  });

  test('should initialize input queue', () => {
    expect(harness.cli.inputQueue).toEqual([]);
    expect(harness.cli.isProcessingInput).toBe(false);
  });
});
