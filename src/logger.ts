import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  category: string;
  message: string;
  metadata?: Record<string, any>;
}

export type LogLevel = LogEntry['level'] | 'false';

export class Logger {
  private static instance: Logger;
  private readonly logDir: string;
  private readonly currentLogFile: string;
  private readonly logBuffer: LogEntry[] = [];
  private readonly flushInterval: NodeJS.Timeout | null = null;
  private readonly logLevel: LogEntry['level'] | false;
  private isShuttingDown = false;

  private shouldLog(level: LogEntry['level']): boolean {
    if (this.logLevel === false) return false;
    
    const levels: LogEntry['level'][] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    
    return messageLevelIndex >= currentLevelIndex;
  }

  private constructor() {
    const debugEnv = process.env.DEBUG?.toUpperCase();
    this.logLevel = (debugEnv === 'FALSE' ? false : 
      (debugEnv === 'DEBUG' || debugEnv === 'INFO' || debugEnv === 'WARN' || debugEnv === 'ERROR') 
        ? debugEnv as LogEntry['level'] 
        : 'DEBUG');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logDir = path.join(os.homedir(), '.mcp', 'logs');
    this.currentLogFile = path.join(this.logDir, `mcp-${timestamp}.log`);

    // Only set up logging infrastructure if enabled
    if (this.logLevel !== false) {
      // Create buffer flush interval
      this.flushInterval = setInterval(() => this.flushBuffer(), 5000);

      // Setup shutdown handlers
      this.setupShutdownHandlers();
    }
  }

  static async init(): Promise<Logger> {
    if (!Logger.instance) {
      Logger.instance = new Logger();
      await Logger.instance.initializeLogDir();
    }
    return Logger.instance;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      throw new Error('Logger not initialized. Call Logger.init() first');
    }
    return Logger.instance;
  }

  private async initializeLogDir() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  private setupShutdownHandlers() {
    const cleanup = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      if(this.flushInterval) {
        clearInterval(this.flushInterval);
      }
      await this.flushBuffer();
    };

    process.on('beforeExit', async () => await cleanup());
    process.on('SIGINT', async () => await cleanup());
    process.on('SIGTERM', async () => await cleanup());
    process.on('uncaughtException', async (error) => {
      await this.error('UNCAUGHT_EXCEPTION', 'Uncaught exception', { error: error.stack });
      await cleanup();
      process.exit(1);
    });
  }

  private async flushBuffer() {
    if (this.logBuffer.length === 0) return;

    const entries = this.logBuffer.splice(0);
    const logContent = entries
      .map(entry => JSON.stringify(entry))
      .join('\n') + '\n';

    try {
      await fs.appendFile(this.currentLogFile, logContent, 'utf8');
    } catch (error) {
      console.error('Failed to write to log file:', error);
      // Re-add entries to buffer if write failed
      this.logBuffer.unshift(...entries);
    }
  }

  private async log(level: LogEntry['level'], category: string, message: string, metadata?: Record<string, any>) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      metadata
    };

    this.logBuffer.push(entry);

    // Flush immediately for errors or if buffer gets too large
    if (level === 'ERROR' || this.logBuffer.length > 1000) {
      await this.flushBuffer();
    }
  }

  // Public logging methods
  async debug(category: string, message: string, metadata?: Record<string, any>) {
    await this.log('DEBUG', category, message, metadata);
  }

  async info(category: string, message: string, metadata?: Record<string, any>) {
    await this.log('INFO', category, message, metadata);
  }

  async warn(category: string, message: string, metadata?: Record<string, any>) {
    await this.log('WARN', category, message, metadata);
  }

  async error(category: string, message: string, metadata?: Record<string, any>) {
    await this.log('ERROR', category, message, metadata);
  }
}
