import {afterEach, beforeEach, describe, expect, it} from '@jest/globals';
import {
  executeCommandHandler,
  forceTerminateHandler,
  listSessionsHandler,
  readOutputHandler
} from '../../../src/server/tools/command_execution';
import {z} from 'zod';
import {
  ExecuteCommandArgsSchema,
  ForceTerminateArgsSchema,
  ReadOutputArgsSchema
} from '../../../src/server/tools/command_execution/schemas';
import os from 'os';

// Access global mock utilities from setup.ts

describe('Command Execution Tool', () => {
  // Keep track of PIDs for cleanup
  let activePids: number[] = [];

  beforeEach(() => {
    // Reset mock processes before each test
    (global as any).resetMockProcesses();
  });

  afterEach(async () => {
    // Clean up any remaining processes
    for (const pid of activePids) {
      try {
        await forceTerminateHandler({ pid });
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    activePids = [];
    
    // Wait a bit for processes to clean up
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('execute_command', () => {
    describe('Quick commands', () => {
      it('should execute a simple echo command successfully', async () => {
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command: 'echo "Hello World"',
          timeout_ms: 5000
        };

        const result = await executeCommandHandler(args);
        expect(result.isError).toBeFalsy();
        
        const textContent = result.content[0];
        if (textContent.type !== 'text') return;
        const text = textContent.text;
        expect(text).toContain('Command started with PID');
        expect(text).toContain('Hello World');
        expect(text).toContain('Command finished quickly');
      });

      it('should handle commands with exit codes', async () => {
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command: 'exit 0',
          timeout_ms: 5000
        };

        const result = await executeCommandHandler(args);
        expect(result.isError).toBeFalsy();
        
        const textContent = result.content[0];
        if (textContent.type !== 'text') return;
        expect(textContent.text).toContain('exit code 0');
      });

      it('should capture stderr output', async () => {
        const command = os.platform() === 'win32' 
          ? 'echo Error message 1>&2' 
          : 'echo "Error message" >&2';
        
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command,
          timeout_ms: 5000
        };

        const result = await executeCommandHandler(args);
        expect(result.isError).toBeFalsy();
        
        const textContent = result.content[0];
        if (textContent.type !== 'text') return;
        expect(textContent.text).toContain('Error message');
      });
    });

    describe('Long-running commands', () => {
      it('should handle commands that exceed timeout', async () => {
        const command = os.platform() === 'win32' 
          ? 'ping -n 10 127.0.0.1' 
          : 'sleep 10';
        
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command,
          timeout_ms: 1000
        };

        const result = await executeCommandHandler(args);
        expect(result.isError).toBeFalsy();
        
        const textContent = result.content[0];
        if (textContent.type !== 'text') return;
        const text = textContent.text;
        const pidMatch = text.match(/PID (\d+)/);
        expect(pidMatch).toBeTruthy();
        
        if (pidMatch) {
          activePids.push(parseInt(pidMatch[1]));
        }
        
        expect(text).toContain('Command is still running');
        expect(text).toContain('Use read_output');
      });

      it('should execute with await_completion mode', async () => {
        const command = os.platform() === 'win32' 
          ? 'ping -n 2 127.0.0.1' 
          : 'sleep 1 && echo "Done"';
        
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command,
          await_completion: true,
          timeout_ms: 1000 // Should be ignored
        };

        const result = await executeCommandHandler(args);
        expect(result.isError).toBeFalsy();
        
        const textContent = result.content[0];
        if (textContent.type !== 'text') return;
        const text = textContent.text;
        expect(text).toContain('completed with exit code');
        if (os.platform() !== 'win32') {
          expect(text).toContain('Done');
        }
      });
    });

    describe('Error handling', () => {
      it('should handle invalid commands', async () => {
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command: 'this_command_definitely_does_not_exist_12345',
          timeout_ms: 5000
        };

        const result = await executeCommandHandler(args);
        // Command might fail with error or might be interpreted by shell
        const textContent = result.content[0];
        if (textContent.type === 'text') {
          // Either it errors or shell reports command not found
          expect(textContent.text.toLowerCase()).toMatch(/error|not found|cannot find|nicht gefunden/);
        }
      });

      it('should handle empty command', async () => {
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command: '',
          timeout_ms: 5000
        };

        const result = await executeCommandHandler(args);
        expect(result.isError).toBeTruthy();
      });
    });

    describe('Shell and CWD options', () => {
      it('should execute with custom shell', async () => {
        const shell = os.platform() === 'win32' ? 'cmd.exe' : 'bash';
        const command = os.platform() === 'win32' ? 'echo %COMSPEC%' : 'echo $SHELL';
        
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command,
          shell,
          timeout_ms: 5000
        };

        const result = await executeCommandHandler(args);
        expect(result.isError).toBeFalsy();
      });

      it('should execute with custom working directory', async () => {
        const tempDir = os.tmpdir();
        const command = os.platform() === 'win32' ? 'cd' : 'pwd';
        
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command,
          cwd: tempDir,
          timeout_ms: 5000
        };

        const result = await executeCommandHandler(args);
        expect(result.isError).toBeFalsy();
        
        const textContent = result.content[0];
        if (textContent.type !== 'text') return;
        const text = textContent.text;
        expect(text.toLowerCase()).toContain(tempDir.toLowerCase().substring(0, 10));
      });
    });
  });

  describe('read_output', () => {
    it('should read output from a running command', async () => {
      const command = os.platform() === 'win32'
        ? 'ping -n 5 127.0.0.1'
        : 'for i in 1 2 3 4 5; do echo "Line $i"; sleep 0.5; done';
      
      const execArgs: z.infer<typeof ExecuteCommandArgsSchema> = {
        command,
        timeout_ms: 500
      };

      const execResult = await executeCommandHandler(execArgs);
      expect(execResult.isError).toBeFalsy();
      
      const textContent = execResult.content[0];
      if (textContent.type !== 'text') return;
      const text = textContent.text;
      const pidMatch = text.match(/PID (\d+)/);
      expect(pidMatch).toBeTruthy();
      
      if (!pidMatch) return;
      const pid = parseInt(pidMatch[1]);
      activePids.push(pid);

      // Wait a bit for more output
      await new Promise(resolve => setTimeout(resolve, 1000));

      const readArgs: z.infer<typeof ReadOutputArgsSchema> = {
        pid,
        timeout_ms: 2000
      };

      const readResult = await readOutputHandler(readArgs);
      expect(readResult.isError).toBeFalsy();
      
      const outputContent = readResult.content[0];
      if (outputContent.type !== 'text') return;
      const output = outputContent.text;
      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(0);
    });

    it('should handle reading from non-existent PID', async () => {
      const readArgs: z.infer<typeof ReadOutputArgsSchema> = {
        pid: 99999999,
        timeout_ms: 1000
      };

      const readResult = await readOutputHandler(readArgs);
      expect(readResult.isError).toBeFalsy();
      const textContent = readResult.content[0];
      if (textContent.type === 'text') {
        expect(textContent.text).toContain('No new output');
      }
    });

    it('should detect when process completes', async () => {
      const command = 'echo "Quick output"';
      
      const execArgs: z.infer<typeof ExecuteCommandArgsSchema> = {
        command,
        timeout_ms: 100 // Very short timeout to force background mode
      };

      const execResult = await executeCommandHandler(execArgs);
      const textContent = execResult.content[0];
      if (textContent.type !== 'text') return;
      const text = textContent.text;
      const pidMatch = text.match(/PID (\d+)/);
      
      if (!pidMatch) return;
      const pid = parseInt(pidMatch[1]);

      // Wait for process to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      const readArgs: z.infer<typeof ReadOutputArgsSchema> = {
        pid,
        timeout_ms: 1000
      };

      const readResult = await readOutputHandler(readArgs);
      expect(readResult.isError).toBeFalsy();
      
      const outputContent = readResult.content[0];
      if (outputContent.type !== 'text') return;
      const output = outputContent.text;
      expect(output).toContain('has completed');
      expect(output).toContain('exit code');
    });
  });

  describe('force_terminate', () => {
    it('should terminate a running process', async () => {
      const command = os.platform() === 'win32'
        ? 'ping -n 100 127.0.0.1'
        : 'sleep 100';
      
      const execArgs: z.infer<typeof ExecuteCommandArgsSchema> = {
        command,
        timeout_ms: 500
      };

      const execResult = await executeCommandHandler(execArgs);
      const textContent = execResult.content[0];
      if (textContent.type !== 'text') return;
      const text = textContent.text;
      const pidMatch = text.match(/PID (\d+)/);
      
      if (!pidMatch) return;
      const pid = parseInt(pidMatch[1]);

      const terminateArgs: z.infer<typeof ForceTerminateArgsSchema> = {
        pid
      };

      const terminateResult = await forceTerminateHandler(terminateArgs);
      expect(terminateResult.isError).toBeFalsy();
      const terminateContent = terminateResult.content[0];
      if (terminateContent.type === 'text') {
        expect(terminateContent.text).toContain('Termination signal sent');
      }

      // Verify process is no longer active
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const sessions = await listSessionsHandler({});
      const sessionsContent = sessions.content[0];
      if (sessionsContent.type === 'text') {
        expect(sessionsContent.text).not.toContain(`PID: ${pid}`);
      }
    });

    it('should handle terminating non-existent PID', async () => {
      const terminateArgs: z.infer<typeof ForceTerminateArgsSchema> = {
        pid: 99999999
      };

      const terminateResult = await forceTerminateHandler(terminateArgs);
      expect(terminateResult.isError).toBeFalsy();
      const terminateContent = terminateResult.content[0];
      if (terminateContent.type === 'text') {
        expect(terminateContent.text).toContain('Failed to send termination signal');
      }
    });
  });

  describe('list_sessions', () => {
    it('should list active sessions', async () => {
      // Start multiple commands
      const commands = [
        os.platform() === 'win32' ? 'ping -n 10 127.0.0.1' : 'sleep 10',
        'echo "Test command"'
      ];

      const pids: number[] = [];

      for (const command of commands) {
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command,
          timeout_ms: 500
        };

        const result = await executeCommandHandler(args);
        const textContent = result.content[0];
        if (textContent.type === 'text') {
          const pidMatch = textContent.text.match(/PID (\d+)/);
          
          if (pidMatch) {
            const pid = parseInt(pidMatch[1]);
            pids.push(pid);
            activePids.push(pid);
          }
        }
      }

      const listResult = await listSessionsHandler({});
      expect(listResult.isError).toBeFalsy();
      
      const textContent = listResult.content[0];
      if (textContent.type !== 'text') return;
      const text = textContent.text;
      
      // At least one command should still be running
      expect(text).toContain('Active sessions');
      expect(text).toMatch(/PID: \d+/);
    });

    it('should handle empty session list', async () => {
      // Ensure no active sessions
      const listResult = await listSessionsHandler({});
      const textContent = listResult.content[0];
      if (textContent.type === 'text') {
        const text = textContent.text;
        
        if (text.includes('Active sessions')) {
          // Clean up any existing sessions
          const pidMatches = text.matchAll(/PID: (\d+)/g);
          for (const match of pidMatches) {
            await forceTerminateHandler({ pid: parseInt(match[1]) });
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      const finalListResult = await listSessionsHandler({});
      const finalContent = finalListResult.content[0];
      if (finalContent.type === 'text') {
        expect(finalContent.text).toContain('No active command sessions');
      }
    });
  });

  describe('Interactive commands', () => {
    it('should detect and handle sudo commands', async () => {
      // Use a command that will fail quickly to avoid actual password prompts
      const args: z.infer<typeof ExecuteCommandArgsSchema> = {
        command: 'sudo --non-interactive echo "test"',
        timeout_ms: 5000
      };

      const result = await executeCommandHandler(args);
      // Interactive commands might fail due to no terminal
      
      const textContent = result.content[0];
      if (textContent.type !== 'text') return;
      const text = textContent.text;
      expect(text).toContain('Interactive command executed');
      expect(text).toContain('Process management features (read_output, force_terminate) are not available');
    });

    it('should detect interactive commands in pipelines', async () => {
      const args: z.infer<typeof ExecuteCommandArgsSchema> = {
        command: 'echo "password" | sudo --non-interactive -S echo "test"',
        timeout_ms: 5000
      };

      const result = await executeCommandHandler(args);
      // Result might have error due to non-interactive mode
      
      const textContent = result.content[0];
      if (textContent.type !== 'text') return;
      const text = textContent.text;
      expect(text).toContain('Interactive command executed');
    });

    it('should detect interactive commands in command chains', async () => {
      const args: z.infer<typeof ExecuteCommandArgsSchema> = {
        command: 'echo "test" && sudo --non-interactive echo "test2"',
        timeout_ms: 5000
      };

      const result = await executeCommandHandler(args);
      // Result might have error due to non-interactive mode
      
      const textContent = result.content[0];
      if (textContent.type !== 'text') return;
      const text = textContent.text;
      expect(text).toContain('Interactive command executed');
    });

    it('should handle other interactive commands', async () => {
      // Use commands that will fail quickly without actual interaction
      const interactiveCommands = [
        'ssh -o BatchMode=yes -o ConnectTimeout=1 nonexistent.host',
        'mysql --connect-timeout=1 -h nonexistent.host',
        'psql -h nonexistent.host --connect-timeout=1'
      ];
      
      for (const command of interactiveCommands) {
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command,
          timeout_ms: 2000
        };

        const result = await executeCommandHandler(args);
        const textContent = result.content[0];
        if (textContent.type !== 'text') continue;
        const text = textContent.text;
        expect(text).toContain('Interactive command executed');
      }
    });

    it('should not treat similar non-interactive commands as interactive', async () => {
      const nonInteractiveCommands = [
        'echo "sudo test"',
        'grep sudo /dev/null 2>/dev/null || true',  // Use /dev/null to avoid file not found
        'echo "*sudo*"'  // Simpler command that won't take long
      ];
      
      for (const command of nonInteractiveCommands) {
        const args: z.infer<typeof ExecuteCommandArgsSchema> = {
          command,
          timeout_ms: 1000
        };

        const result = await executeCommandHandler(args);
        const textContent = result.content[0];
        if (textContent.type !== 'text') continue;
        const text = textContent.text;
        expect(text).not.toContain('Interactive command executed');
        expect(text).toContain('Command started with PID');
      }
    }, 10000);  // Increase test timeout

    it('should handle timeout for interactive commands', async () => {
      const args: z.infer<typeof ExecuteCommandArgsSchema> = {
        command: 'sudo --non-interactive sleep 5',
        timeout_ms: 1000,
        await_completion: false
      };

      const result = await executeCommandHandler(args);
      // Interactive commands with exec might timeout or fail
      const textContent = result.content[0];
      if (textContent.type === 'text') {
        expect(textContent.text).toMatch(/Interactive command executed|timed out|password is required/);
      }
    });

    it('should return special PID -2 for interactive commands', async () => {
      const args: z.infer<typeof ExecuteCommandArgsSchema> = {
        command: 'sudo --non-interactive echo "test"',
        timeout_ms: 5000
      };

      const result = await executeCommandHandler(args);
      // Result might have error due to non-interactive mode
      
      // The PID -2 is internal, but we can verify the behavior
      const textContent = result.content[0];
      if (textContent.type !== 'text') return;
      const text = textContent.text;
      expect(text).not.toContain('PID -2'); // Should not expose internal PID
      expect(text).toContain('Interactive command executed');
    });
  });

  describe('Process management with interactive commands', () => {
    it('should handle read_output for interactive commands', async () => {
      const readArgs: z.infer<typeof ReadOutputArgsSchema> = {
        pid: -2, // Special PID for interactive commands
        timeout_ms: 1000
      };

      const readResult = await readOutputHandler(readArgs);
      expect(readResult.isError).toBeFalsy();
      const textContent = readResult.content[0];
      if (textContent.type === 'text') {
        expect(textContent.text).toContain('This was an interactive command');
        expect(textContent.text).toContain('Output reading is not available');
      }
    });

    it('should handle force_terminate for interactive commands', async () => {
      const terminateArgs: z.infer<typeof ForceTerminateArgsSchema> = {
        pid: -2 // Special PID for interactive commands
      };

      const terminateResult = await forceTerminateHandler(terminateArgs);
      expect(terminateResult.isError).toBeFalsy();
      const terminateContent = terminateResult.content[0];
      if (terminateContent.type === 'text') {
        expect(terminateContent.text).toContain('Failed to send termination signal');
      }
    });

    it('should not list interactive commands in active sessions', async () => {
      // First, clean up any existing sessions
      const initialList = await listSessionsHandler({});
      if (initialList.content[0].type === 'text' && initialList.content[0].text.includes('PID:')) {
        // Extract and terminate any existing processes
        const pidMatches = initialList.content[0].text.matchAll(/PID: (\d+)/g);
        for (const match of pidMatches) {
          await forceTerminateHandler({ pid: parseInt(match[1]) });
        }
        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Execute an interactive command
      await executeCommandHandler({
        command: 'sudo --non-interactive echo "test"',
        timeout_ms: 5000
      });

      // List sessions should not include it
      const listResult = await listSessionsHandler({});
      const textContent = listResult.content[0];
      if (textContent.type === 'text') {
        // Interactive commands should not be tracked in sessions
        expect(textContent.text).toMatch(/No active command sessions|Active sessions/);
        if (textContent.text.includes('Active sessions')) {
          expect(textContent.text).not.toContain('sudo');
        }
      }
    });
  });

  describe('Integration scenarios', () => {
    it('should handle full lifecycle: execute, read, terminate', async () => {
      const command = os.platform() === 'win32'
        ? 'ping -n 10 127.0.0.1'
        : 'for i in {1..10}; do echo "Count: $i"; sleep 0.3; done';
      
      // Execute command
      const execArgs: z.infer<typeof ExecuteCommandArgsSchema> = {
        command,
        timeout_ms: 1000
      };

      const execResult = await executeCommandHandler(execArgs);
      expect(execResult.isError).toBeFalsy();
      
      const execContent = execResult.content[0];
      if (execContent.type !== 'text') return;
      const execText = execContent.text;
      const pidMatch = execText.match(/PID (\d+)/);
      expect(pidMatch).toBeTruthy();
      
      if (!pidMatch) return;
      const pid = parseInt(pidMatch[1]);
      activePids.push(pid);

      // Read output multiple times
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const readResult = await readOutputHandler({ pid, timeout_ms: 1000 });
        expect(readResult.isError).toBeFalsy();
        
        const outputContent = readResult.content[0];
        if (outputContent.type === 'text') {
          const output = outputContent.text;
          if (output && !output.includes('No new output')) {
            expect(output.length).toBeGreaterThan(0);
          }
        }
      }

      // Terminate the process
      const terminateResult = await forceTerminateHandler({ pid });
      expect(terminateResult.isError).toBeFalsy();

      // Verify termination
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const finalReadResult = await readOutputHandler({ pid, timeout_ms: 1000 });
      const finalContent = finalReadResult.content[0];
      if (finalContent.type === 'text') {
        expect(finalContent.text).toMatch(/has completed|No new output/);
      }
    }, 15000); // 15 second timeout for this test

    it('should handle multiple concurrent processes', async () => {
      const commands = [
        'echo "Process 1"',
        'echo "Process 2"',
        'echo "Process 3"'
      ];

      const results = await Promise.all(
        commands.map(command => 
          executeCommandHandler({ command, timeout_ms: 5000 })
        )
      );

      results.forEach((result, index) => {
        expect(result.isError).toBeFalsy();
        const textContent = result.content[0];
        if (textContent.type === 'text') {
          expect(textContent.text).toContain(`Process ${index + 1}`);
        }
      });
    });
  });
});
