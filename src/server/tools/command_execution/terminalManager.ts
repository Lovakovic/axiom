import { spawn, ChildProcess, SpawnOptions, exec } from 'child_process';
import os from 'os';
import util from 'util';

const execPromise = util.promisify(exec);

const DEFAULT_INITIAL_TIMEOUT = 10000;

export interface TerminalSession {
  pid: number;
  process: ChildProcess;
  command: string;
  fullOutput: string; // Store all output here
  newOutputBuffer: string; // Buffer for output since last read_output
  isBlocked: boolean; // True if the initial timeout passed and it's running in background
  startTime: Date;
  shell?: string;
  cwd?: string;
}

interface CompletedSessionInfo {
  pid: number;
  command: string;
  output: string;
  exitCode: number | null;
  startTime: Date;
  endTime: Date;
}

export class TerminalManager {
  private sessions: Map<number, TerminalSession> = new Map();
  private completedSessions: Map<number, CompletedSessionInfo> = new Map(); // Store info about completed ones

  async executeCommand(
    command: string,
    timeoutMs: number = DEFAULT_INITIAL_TIMEOUT,
    shell?: string,
    cwd?: string,
    awaitCompletion: boolean = false
  ): Promise<{ pid: number; initialOutput: string; isBlocked: boolean; error?: string, exitCode?: number | null }> {

    // Check if command requires interactive input (like sudo)
    const interactiveCommands = ['sudo', 'ssh', 'passwd', 'su', 'mysql', 'psql', 'ftp', 'telnet', 'gpg'];
    const isInteractive = interactiveCommands.some(cmd => {
      // Check if command starts with the interactive command
      if (command.startsWith(cmd + ' ') || command === cmd) return true;
      
      // Check for the command after pipes or logical operators
      const patterns = [
        `| ${cmd} `,
        `| ${cmd}$`,
        `&& ${cmd} `,
        `&& ${cmd}$`,
        `|| ${cmd} `,
        `|| ${cmd}$`,
        `; ${cmd} `,
        `; ${cmd}$`
      ];
      
      return patterns.some(pattern => command.includes(pattern));
    });
    
    // Use exec for interactive commands to inherit TTY
    if (isInteractive) {
      try {
        // For interactive commands, we return a special PID (-2) to indicate it's an exec command
        // This helps other tools understand that process management features are not available
        const execOptions = {
          cwd: cwd || os.homedir(),
          shell: shell || undefined,
          timeout: awaitCompletion ? 0 : timeoutMs // Apply timeout if not awaiting completion
        };
        
        const { stdout, stderr } = await execPromise(command, execOptions);
        return {
          pid: -2, // Special PID to indicate exec command (no process management)
          initialOutput: `${stdout}${stderr ? `\n${stderr}` : ''}`,
          isBlocked: false,
          exitCode: 0
        };
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error';
        const isTimeout = error.code === 'ETIMEDOUT';
        
        return {
          pid: -2,
          initialOutput: isTimeout 
            ? `Command timed out after ${timeoutMs}ms. Interactive commands may need more time.\nPartial output: ${error.stdout || ''}${error.stderr ? `\nErrors: ${error.stderr}` : ''}`
            : `Error executing command: ${errorMessage}`,
          isBlocked: false,
          error: errorMessage,
          exitCode: error.code || 1
        };
      }
    }

    const spawnOptions: SpawnOptions = {
      shell: shell || true, // Use specified shell or OS default
      stdio: ['pipe', 'pipe', 'pipe'], // Keep stdio piped
      cwd: cwd || os.homedir(), // Default to home directory if no CWD provided
      detached: os.platform() !== 'win32' // Detach on non-Windows to allow parent to exit if needed
    };

    try {
      const process = spawn(command, [], spawnOptions);

      if (!process.pid) {
        return { pid: -1, initialOutput: 'Error: Failed to get process ID.', isBlocked: false, error: 'Failed to get process ID.', exitCode: null };
      }

      const session: TerminalSession = {
        pid: process.pid,
        process,
        command,
        fullOutput: '',
        newOutputBuffer: '',
        isBlocked: false, // Will be set true if timeoutMs is reached before exit
        startTime: new Date(),
        shell,
        cwd
      };
      this.sessions.set(process.pid, session);

      return new Promise((resolve) => {
        let initialOutputCollected = '';
        let resolved = false;

        const onData = (data: Buffer) => {
          const text = data.toString();
          session.fullOutput += text;
          session.newOutputBuffer += text;
          if (!resolved) {
            initialOutputCollected += text;
          }
        };

        process.stdout?.on('data', onData);
        process.stderr?.on('data', onData);

        const timer = awaitCompletion ? null : setTimeout(() => {
          if (!resolved) {
            resolved = true;
            session.isBlocked = true; // Mark as blocked (long-running)
            resolve({ pid: process.pid!, initialOutput: initialOutputCollected, isBlocked: true, exitCode: null });
          }
        }, timeoutMs);

        process.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            if (timer) clearTimeout(timer);
            this.sessions.delete(process.pid!);
            resolve({ pid: process.pid!, initialOutput: initialOutputCollected + `\nError: ${err.message}`, isBlocked: false, error: err.message, exitCode: null });
          } else {
            // If already resolved (e.g. timed out), just log the error or append to session output
            session.fullOutput += `\nProcess Error: ${err.message}`;
            session.newOutputBuffer += `\nProcess Error: ${err.message}`;
          }
        });

        process.on('exit', (code, signal) => {
          if (timer) clearTimeout(timer);
          const finalOutputChunk = session.newOutputBuffer; // Grab any remaining output

          const completedInfo: CompletedSessionInfo = {
            pid: session.pid,
            command: session.command,
            output: session.fullOutput, // Full historical output
            exitCode: code,
            startTime: session.startTime,
            endTime: new Date(),
          };
          this.completedSessions.set(session.pid, completedInfo);
          // Keep last 10 completed sessions for potential inspection
          if (this.completedSessions.size > 10) {
            const oldestKey = Array.from(this.completedSessions.keys())[0];
            this.completedSessions.delete(oldestKey);
          }

          this.sessions.delete(session.pid);
          if (!resolved) {
            resolved = true;
            resolve({ pid: session.pid, initialOutput: initialOutputCollected + finalOutputChunk, isBlocked: false, exitCode: code });
          }
        });
      });
    } catch (error: any) {
      return { pid: -1, initialOutput: `Error spawning command: ${error.message}`, isBlocked: false, error: error.message, exitCode: null };
    }
  }

  readNewOutput(pid: number): string | null {
    // Handle special PIDs for exec commands
    if (pid === -2) {
      return "This was an interactive command executed with 'exec'. Output reading is not available for interactive commands.";
    }
    
    const session = this.sessions.get(pid);
    if (session) {
      const output = session.newOutputBuffer;
      session.newOutputBuffer = ''; // Clear buffer after reading
      return output;
    }

    const completedSession = this.completedSessions.get(pid);
    if(completedSession){
      const runtime = (completedSession.endTime.getTime() - completedSession.startTime.getTime()) / 1000;
      // For completed sessions, signal completion clearly.
      // We don't return full historical output here, just the completion notice.
      // Agent can re-run if they need full output, or we could add a get_session_log tool.
      return `Process PID ${pid} (${completedSession.command}) has completed with exit code ${completedSession.exitCode}. Runtime: ${runtime.toFixed(2)}s.`;
    }
    return null; // No active session, no completed info found
  }

  forceTerminate(pid: number): boolean {
    // Handle special PIDs for exec commands
    if (pid === -2) {
      // Can't terminate exec commands as we don't track their actual PID
      return false;
    }
    
    const session = this.sessions.get(pid);
    if (!session) {
      // Check if it's a detached process we might still be able to kill
      try {
        process.kill(pid, 'SIGTERM'); // Try SIGTERM first
        setTimeout(() => {
          try { process.kill(pid, 'SIGKILL'); } catch (e) { /* ignore if already gone */ }
        }, 1000);
        return true; // Assume success if kill doesn't throw immediately
      } catch (e) {
        return false;
      }
    }

    try {
      // For child processes, we have more control
      if (os.platform() === 'win32') {
        spawn('taskkill', ['/pid', session.process.pid!.toString(), '/f', '/t']);
      } else {
        // Send SIGTERM to the process group to kill children as well
        process.kill(-session.process.pid!, 'SIGTERM'); // Note the negative PID for process group
        setTimeout(() => {
          if (this.sessions.has(pid)) { // If still in sessions, it didn't exit
            try { process.kill(-session.process.pid!, 'SIGKILL'); }
            catch (e) { /* Process might have exited in the meantime */ }
          }
        }, 1000); // Wait 1 sec before SIGKILL
      }
      // Don't remove from sessions immediately, let the 'exit' event handle it.
      return true;
    } catch (error) {
      console.error(`Failed to terminate process ${pid}:`, error);
      return false;
    }
  }

  listActiveSessions(): Array<{ pid: number; command: string; startTime: Date; isBlocked: boolean, shell?: string, cwd?:string }> {
    return Array.from(this.sessions.values()).map(s => ({
      pid: s.pid,
      command: s.command,
      startTime: s.startTime,
      isBlocked: s.isBlocked,
      shell: s.shell,
      cwd: s.cwd,
    }));
  }

  getSessionStatus(pid: number): 'running' | 'completed' | 'not_found' {
    // Handle special PIDs for exec commands
    if (pid === -2) {
      return 'not_found'; // exec commands are not tracked
    }
    
    if (this.sessions.has(pid)) return 'running';
    if (this.completedSessions.has(pid)) return 'completed';
    return 'not_found';
  }
}

export const terminalManager = new TerminalManager();