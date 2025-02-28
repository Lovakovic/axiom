// Mock fs module to avoid actual file operations during tests
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('mock file content')),
  readdir: jest.fn().mockResolvedValue([{ isFile: () => true, name: 'mockfile.jpg' }])
}));

// Mock child_process to avoid actual process spawning
jest.mock('child_process', () => ({
  spawn: jest.fn().mockReturnValue({
    on: jest.fn(),
    pid: 12345,
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() }
  }),
  exec: jest.fn().mockImplementation((cmd, cb) => {
    if (cb) cb(null, { stdout: 'mock output', stderr: '' });
    return {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn()
    };
  })
}));
