import chalk from 'chalk';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: chalk.gray('[DBG]'),
  info: chalk.blue('[INF]'),
  warn: chalk.yellow('[WRN]'),
  error: chalk.red('[ERR]'),
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatMessage(level: LogLevel, msg: string, context?: string): string {
  const prefix = LEVEL_PREFIX[level];
  const ctx = context ? chalk.gray(` [${context}]`) : '';
  return `${prefix}${ctx} ${msg}`;
}

export const logger = {
  debug(msg: string, context?: string): void {
    if (shouldLog('debug')) {
      console.error(formatMessage('debug', msg, context));
    }
  },

  info(msg: string, context?: string): void {
    if (shouldLog('info')) {
      console.error(formatMessage('info', msg, context));
    }
  },

  warn(msg: string, context?: string): void {
    if (shouldLog('warn')) {
      console.error(formatMessage('warn', msg, context));
    }
  },

  error(msg: string, context?: string): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', msg, context));
    }
  },

  success(msg: string): void {
    console.error(`${chalk.green('[OK]')} ${msg}`);
  },
};
