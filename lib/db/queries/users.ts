import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../drizzle';
import type { User } from '../schema';
import { users } from '../schema';

export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const rows = await db
    .update(users)
    .set({
      passwordHash,
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, userId))
    .returning({ tokenVersion: users.tokenVersion });

  return rows[0] ?? null;
}

export async function updateUserProfile(params: {
  userId: number;
  name: string;
  email: string;
}) {
  const { userId, name, email } = params;
  await db.update(users).set({ name, email }).where(eq(users.id, userId));
}
