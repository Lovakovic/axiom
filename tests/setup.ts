// Mock fs module selectively - only for tests that need it
// The editBlockTool tests use real file operations in a temp directory

// Mock the Logger to prevent initialization issues in tests
jest.mock('../src/logger', () => {
  const mockLogger = {
    info: jest.fn().mockResolvedValue(undefined),
    debug: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
    isActive: jest.fn().mockReturnValue(true),
    getArchivedLogs: jest.fn().mockReturnValue([])
  };

  return {
    Logger: {
      init: jest.fn().mockResolvedValue(mockLogger),
      getInstance: jest.fn().mockReturnValue(mockLogger)
    },
    LogEntry: jest.fn()
  };
});

// Mock child_process to avoid actual process spawning
let mockPidCounter = 10000;
const mockProcesses = new Map();
const activeIntervals = new Set<NodeJS.Timeout>();

jest.mock('child_process', () => {
  const EventEmitter = require('events');
  
  return {
    spawn: jest.fn().mockImplementation((command, args, options) => {
      // Handle empty command like real spawn does
      if (!command || command === '') {
        throw new Error("The argument 'file' cannot be empty. Received ''");
      }
      
      const pid = mockPidCounter++;
      const mockProcess = new EventEmitter();
      mockProcess.pid = pid;
      
      // Create stdout and stderr as EventEmitters
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      
      // Store the process for later manipulation
      mockProcesses.set(pid, {
        process: mockProcess,
        command: command + ' ' + (args || []).join(' '),
        isRunning: true,
        exitCode: null
      });
      
      // Simulate process behavior based on command
      setImmediate(() => {
        const fullCommand = command + ' ' + (args || []).join(' ');
        
        // Exit command
        if (fullCommand.startsWith('exit')) {
          const exitCodeMatch = fullCommand.match(/exit\s+(\d+)/);
          const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1]) : 0;
          setTimeout(() => {
            if (mockProcesses.has(pid)) {
              mockProcesses.get(pid).isRunning = false;
              mockProcesses.get(pid).exitCode = exitCode;
            }
            mockProcess.emit('exit', exitCode, null);
          }, 50);
        }
        // Quick commands that finish immediately
        else if (fullCommand.includes('echo') && !fullCommand.includes('for i in')) {
          const match = fullCommand.match(/echo\s+"?([^"]*)"?/);
          const output = match ? match[1] : 'Hello World';
          mockProcess.stdout.emit('data', Buffer.from(output + '\n'));
          
          setTimeout(() => {
            if (mockProcesses.has(pid)) {
              mockProcesses.get(pid).isRunning = false;
              mockProcesses.get(pid).exitCode = 0;
            }
            mockProcess.emit('exit', 0, null);
          }, 50);
        }
        // Commands that output to stderr
        else if (fullCommand.includes('>&2')) {
          mockProcess.stderr.emit('data', Buffer.from('Error message\n'));
          setTimeout(() => {
            if (mockProcesses.has(pid)) {
              mockProcesses.get(pid).isRunning = false;
              mockProcesses.get(pid).exitCode = 0;
            }
            mockProcess.emit('exit', 0, null);
          }, 50);
        }
        // Sleep or long-running commands
        else if (fullCommand.includes('sleep') || fullCommand.includes('ping')) {
          // For long-running commands, emit some data periodically
          let counter = 0;
          const interval = setInterval(() => {
            activeIntervals.add(interval);
            if (!mockProcesses.has(pid) || !mockProcesses.get(pid).isRunning) {
              clearInterval(interval);
              activeIntervals.delete(interval);
              return;
            }
            counter++;
            if (fullCommand.includes('for i in')) {
              mockProcess.stdout.emit('data', Buffer.from(`Line ${counter}\n`));
            } else if (fullCommand.includes('Count:')) {
              mockProcess.stdout.emit('data', Buffer.from(`Count: ${counter}\n`));
            } else if (fullCommand.includes('ping')) {
              mockProcess.stdout.emit('data', Buffer.from(`Reply from 127.0.0.1: bytes=32 time<1ms TTL=64\n`));
            }
          }, 200);
          
          // Set timeout based on sleep duration or default
          const sleepMatch = fullCommand.match(/sleep\s+(\d+)/);
          const timeout = sleepMatch ? parseInt(sleepMatch[1]) * 1000 : 10000;
          
          setTimeout(() => {
            clearInterval(interval);
            activeIntervals.delete(interval);
            if (mockProcesses.has(pid)) {
              mockProcesses.get(pid).isRunning = false;
              mockProcesses.get(pid).exitCode = 0;
            }
            mockProcess.emit('exit', 0, null);
          }, timeout);
        }
        // Commands that don't exist
        else if (fullCommand.includes('this_command_definitely_does_not_exist')) {
          mockProcess.stderr.emit('data', Buffer.from('command not found\n'));
          setTimeout(() => {
            if (mockProcesses.has(pid)) {
              mockProcesses.get(pid).isRunning = false;
              mockProcesses.get(pid).exitCode = 127;
            }
            mockProcess.emit('exit', 127, null);
          }, 50);
        }
        // pwd command
        else if (command === 'pwd' || command === 'cd') {
          const cwd = options?.cwd || process.cwd();
          mockProcess.stdout.emit('data', Buffer.from(cwd + '\n'));
          setTimeout(() => {
            if (mockProcesses.has(pid)) {
              mockProcesses.get(pid).isRunning = false;
              mockProcesses.get(pid).exitCode = 0;
            }
            mockProcess.emit('exit', 0, null);
          }, 50);
        }
        // Default behavior for other commands
        else {
          mockProcess.stdout.emit('data', Buffer.from('mock output\n'));
          setTimeout(() => {
            if (mockProcesses.has(pid)) {
              mockProcesses.get(pid).isRunning = false;
              mockProcesses.get(pid).exitCode = 0;
            }
            mockProcess.emit('exit', 0, null);
          }, 100);
        }
      });
      
      // Add kill method
      mockProcess.kill = jest.fn().mockImplementation((signal) => {
        if (mockProcesses.has(pid) && mockProcesses.get(pid).isRunning) {
          mockProcesses.get(pid).isRunning = false;
          mockProcesses.get(pid).exitCode = -1;
          // Clear any running intervals
          mockProcess.emit('exit', null, signal || 'SIGTERM');
        }
        return true;
      });
      
      return mockProcess;
    }),
    
    exec: jest.fn().mockImplementation((cmd, options, cb) => {
      // Handle both (cmd, cb) and (cmd, options, cb) signatures
      const callback = typeof options === 'function' ? options : cb;
      const mockProcess = new EventEmitter();
      
      // For interactive commands, simulate immediate execution
      if (cmd.includes('sudo') || cmd.includes('ssh') || cmd.includes('mysql') || cmd.includes('psql')) {
        if (callback) {
          if (cmd.includes('--non-interactive')) {
            callback(new Error('sudo: a password is required'), '', 'sudo: a password is required\n');
          } else {
            callback(null, 'Interactive command executed\n', '');
          }
        }
      } else {
        if (callback) callback(null, 'mock output', '');
      }
      
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      
      return mockProcess;
    })
  };
});

// Export for test access
(global as any).mockProcesses = mockProcesses;
(global as any).resetMockProcesses = () => {
  mockPidCounter = 10000;
  mockProcesses.clear();
  // Clear any active intervals
  activeIntervals.forEach(interval => clearInterval(interval));
  activeIntervals.clear();
};

// Mock process.kill for checking if process exists
const originalProcessKill = process.kill;
process.kill = jest.fn().mockImplementation((pid, signal) => {
  // Handle negative PIDs (process groups)
  const actualPid = Math.abs(pid);
  
  // If signal is 0, we're just checking if process exists
  if (signal === 0) {
    // Check our mock processes
    if (mockProcesses.has(actualPid) && mockProcesses.get(actualPid).isRunning) {
      return true;
    }
    // Throw error if not found
    const err = new Error('kill ESRCH');
    (err as any).errno = -3;
    (err as any).code = 'ESRCH';
    (err as any).syscall = 'kill';
    throw err;
  }
  
  // For actual kill signals, check mock processes first
  if (mockProcesses.has(actualPid)) {
    const mockProc = mockProcesses.get(actualPid);
    if (mockProc.isRunning) {
      mockProc.process.kill(signal);
    }
    return true;
  }
  
  // If process not found, throw ESRCH error
  const err = new Error('kill ESRCH');
  (err as any).errno = -3;
  (err as any).code = 'ESRCH';
  (err as any).syscall = 'kill';
  throw err;
});
