type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

type LogContext = Record<string, unknown>;

type LoggerState = {
  level: Level | null;
  contextProvider: (() => LogContext | undefined) | undefined;
};

// This module is bundled twice (Server Components + the client error boundary).
// Module-level `let` would give each bundle its own state, so instrumentation.ts
// setting the level in one instance would leave the other stuck at the quiet
// 'error' fallback. A well-known symbol on globalThis gives every instance the
// same single owner. The client bundle never calls setLogLevel, so it still
// falls back to 'error' and stays quiet. This file cannot import lib/config.ts
// (server-only); the validated level is installed by instrumentation.ts.
const STATE_KEY = Symbol.for('gramps.logger');

function state(): LoggerState {
  const host = globalThis as unknown as {
    [k: symbol]: LoggerState | undefined;
  };
  let current = host[STATE_KEY];
  if (!current) {
    current = { level: null, contextProvider: undefined };
    host[STATE_KEY] = current;
  }
  return current;
}

/** Called once from instrumentation.ts with the level from lib/config.ts. */
export function setLogLevel(level: Level) {
  state().level = level;
}

function currentLevel(): Level {
  return state().level ?? 'error';
}

// Server-only module registers a provider backed by AsyncLocalStorage so every
// log line carries request_id/user_id without threading context through calls.
export function setLogContextProvider(
  provider: (() => LogContext | undefined) | undefined
) {
  state().contextProvider = provider;
}

function write(level: Level, message: string, context?: LogContext) {
  const current = state();
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel()]) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...(current.contextProvider?.() ?? {}),
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
