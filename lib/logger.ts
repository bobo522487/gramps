type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// This module is shared by Server Components and the client error boundary, so
// it cannot import lib/config.ts (which is server-only). instrumentation.ts
// installs the validated level at startup; the fallback keeps the browser quiet.
let levelOverride: Level | null = null;

/** Called once from instrumentation.ts with the level from lib/config.ts. */
export function setLogLevel(level: Level) {
  levelOverride = level;
}

function currentLevel(): Level {
  return levelOverride ?? 'error';
}

type LogContext = Record<string, unknown>;

// Server-only module registers a provider backed by AsyncLocalStorage so every
// log line carries request_id/user_id without threading context through calls.
let contextProvider: (() => LogContext | undefined) | undefined;

export function setLogContextProvider(
  provider: (() => LogContext | undefined) | undefined
) {
  contextProvider = provider;
}

function write(level: Level, message: string, context?: LogContext) {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel()]) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...(contextProvider?.() ?? {}),
    ...(context ?? {}),
  });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    write('warn', message, context),
  error: (
    message: string,
    error?: unknown,
    context?: Record<string, unknown>
  ) =>
    write('error', message, {
      ...(context ?? {}),
      ...(error instanceof Error
        ? {
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
            },
          }
        : { error: String(error) }),
    }),
};
