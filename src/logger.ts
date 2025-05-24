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

export interface ILogger {
  info(category: string, message: string, metadata?: Record<string, any>): Promise<void>;
  debug(category: string, message: string, metadata?: Record<string, any>): Promise<void>;
  warn(category: string, message: string, metadata?: Record<string, any>): Promise<void>;
  error(category: string, message: string, metadata?: Record<string, any>): Promise<void>;
  isActive(): boolean;
  getArchivedLogs(): LogEntry[];
}

const MAX_ARCHIVED_LOGS = 200;

export class Logger implements ILogger {
  private static instance: Logger;
  private readonly logDir: string;
  private readonly currentLogFile: string;
  private readonly logBuffer: LogEntry[] = [];
  private readonly flushInterval: NodeJS.Timeout | null = null;
  private readonly logLevel: LogEntry['level'] | false;
  private isShuttingDown = false;
  private recentLogsArchive: LogEntry[] = []; // Added for debug server

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
        : 'DEBUG'); // Default to DEBUG if DEBUG is set to anything other than FALSE, INFO, WARN, ERROR

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logDir = path.join(os.homedir(), '.mcp', 'logs');
    this.currentLogFile = path.join(this.logDir, `mcp-${timestamp}.log`);

    if (this.isActive()) {
      this.flushInterval = setInterval(() => this.flushBuffer(), 5000);
      this.setupShutdownHandlers();
    }
  }

  static async init(): Promise<Logger> {
    if (!Logger.instance) {
      Logger.instance = new Logger();
      if (Logger.instance.isActive()) {
        await Logger.instance.initializeLogDir();
      }
    }
    return Logger.instance;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      throw new Error('Logger not initialized. Call Logger.init() first');
    }
    return Logger.instance;
  }

  public isActive(): boolean {
    return this.logLevel !== false;
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
      // Log critical error if possible
      if (this.isActive()) {
         await this.error('UNCAUGHT_EXCEPTION', 'Uncaught exception before shutdown', { error: error.stack });
      }
      await cleanup();
      // process.exit(1); // Let the main CLI handler manage exit
    });
  }

  private async flushBuffer() {
    if (this.logBuffer.length === 0 || !this.isActive()) return;

    const entries = this.logBuffer.splice(0);
    const logContent = entries
      .map(entry => JSON.stringify(entry))
      .join('\n') + '\n';

    try {
      await fs.appendFile(this.currentLogFile, logContent, 'utf8');
    } catch (error) {
      console.error('Failed to write to log file:', error);
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

    // Add to recentLogsArchive (circular buffer)
    this.recentLogsArchive.push(entry);
    if (this.recentLogsArchive.length > MAX_ARCHIVED_LOGS) {
      this.recentLogsArchive.shift(); // Remove the oldest entry
    }

    if (level === 'ERROR' || this.logBuffer.length > 1000) {
      await this.flushBuffer();
    }
  }

  public getArchivedLogs(): LogEntry[] {
    return [...this.recentLogsArchive]; // Return a copy
  }

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
