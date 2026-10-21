import { sql } from 'drizzle-orm';
import { withApiLogging } from '@/lib/api';
import { db } from '@/lib/db/drizzle';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

async function healthCheck() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: 'ok', database: 'up' });
  } catch (error) {
    logger.error('health check failed', error);
    return Response.json(
      { status: 'error', database: 'down' },
      { status: 503 }
    );
  }
}

export const GET = withApiLogging('health', healthCheck);
