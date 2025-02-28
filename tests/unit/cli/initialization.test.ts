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

  test('should setup signal handlers', () => {
    expect(harness.cli.ctrlCCount).toBe(0);
    expect(harness.cli.isCurrentlyInterrupted).toBe(false);

    harness.sendCtrlC();
    expect(harness.cli.ctrlCCount).toBe(1);
    expect(harness.cli.isCurrentlyInterrupted).toBe(true);
  });

  test('should initialize input queue', () => {
    expect(harness.cli.inputQueue).toEqual([]);
    expect(harness.cli.isProcessingInput).toBe(false);
  });
});
