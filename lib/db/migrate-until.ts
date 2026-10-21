import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

dotenv.config();

const MIGRATIONS_DIR = path.join(process.cwd(), 'lib/db/migrations');

type Journal = {
  version: string;
  dialect: string;
  entries: { idx: number; tag: string }[];
};

// drizzle-kit migrate always applies every pending migration in one
// transaction, so a two-phase upgrade (backfill between phases) needs a
// target-tag runner.
async function main() {
  const target = process.argv[2];
  if (!target) {
    throw new Error('Usage: pnpm db:migrate:until <migration-tag>');
  }

  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as Journal;
  const targetEntry = journal.entries.find((entry) => entry.tag === target);
  if (!targetEntry) {
    throw new Error(`Unknown migration tag: ${target}`);
  }

  const entries = journal.entries.filter(
    (entry) => entry.idx <= targetEntry.idx
  );
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gramps-migrate-'));
  try {
    await fs.mkdir(path.join(tempDir, 'meta'));
    for (const entry of entries) {
      const file = `${entry.tag}.sql`;
      await fs.copyFile(
        path.join(MIGRATIONS_DIR, file),
        path.join(tempDir, file)
      );
    }
    await fs.writeFile(
      path.join(tempDir, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries }, null, 2)
    );

    if (!process.env.POSTGRES_URL) {
      throw new Error('POSTGRES_URL environment variable is not set.');
    }
    const sql = postgres(process.env.POSTGRES_URL, { max: 1 });
    try {
      await migrate(drizzle(sql), { migrationsFolder: tempDir });
    } finally {
      await sql.end();
    }
    console.log(`Migrations applied up to ${target}.`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('Stepwise migration failed:', error);
  process.exit(1);
});
