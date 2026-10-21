export async function register() {
  // Only the Node runtime can load AsyncLocalStorage and the DB driver.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  // `next build` also evaluates server modules; config is a runtime concern.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  const [{ getServerConfig }, { logger }] = await Promise.all([
    import('@/lib/config'),
    import('@/lib/logger'),
  ]);

  try {
    const config = getServerConfig();
    logger.info('server configuration validated', {
      log_level: config.LOG_LEVEL ?? 'default',
    });
  } catch (error) {
    logger.error('invalid server configuration', error);
    throw error;
  }

  // Registers the AsyncLocalStorage-backed log context provider.
  await import('@/lib/server/request-context');
}
