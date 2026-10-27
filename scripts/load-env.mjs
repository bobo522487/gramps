import { config } from 'dotenv';

let loaded = false;

/**
 * Loads .env once for entry points that run outside the Next.js runtime
 * (tsx scripts, test helpers, standalone node scripts). Next loads .env itself,
 * so modules the server bundle imports must not call this — a module-scope
 * load there would re-run the side effect on every serverless cold start.
 */
export function loadEnv() {
  if (loaded) {
    return;
  }
  // Keep startup output quiet; dotenv >= 17 logs an injection summary by default.
  config({ quiet: true });
  loaded = true;
}
