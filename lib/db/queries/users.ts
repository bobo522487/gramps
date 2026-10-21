import 'server-only';

import { sql } from 'drizzle-orm';
import { db, queryRows, withOrg } from '../drizzle';
import type { User } from '../schema';

export type UserCredentials = Pick<
  User,
  'id' | 'email' | 'name' | 'passwordHash' | 'tokenVersion' | 'deletedAt'
>;

/** Login lookup; anonymous, so it goes through the SECURITY DEFINER function. */
export async function findUserByEmail(
  email: string
): Promise<UserCredentials | null> {
  const rows = await queryRows<UserCredentials>(
    db,
    sql`
      select id, email, name,
             password_hash as "passwordHash",
             token_version as "tokenVersion",
             deleted_at as "deletedAt"
      from auth.find_user_by_email(${email})
      where deleted_at is null
      limit 1
    `
  );
  return rows[0] ?? null;
}

/** Authoritative session lookup, scoped to the verified JWT subject. */
export async function getSessionUserById(userId: string): Promise<User | null> {
  return withOrg(userId, async (tx) => {
    const rows = await queryRows<User>(
      tx,
      sql`
        select id, email, name,
               password_hash as "passwordHash",
               token_version as "tokenVersion",
               created_at as "createdAt",
               updated_at as "updatedAt",
               deleted_at as "deletedAt"
        from auth.get_session_user()
        where id = ${userId}::uuid
        limit 1
      `
    );
    return rows[0] ?? null;
  });
}

export async function updateUserPassword(
  userId: string,
  passwordHash: string
): Promise<number | null> {
  return withOrg(userId, async (tx) => {
    const rows = await queryRows<{ tokenVersion: number }>(
      tx,
      sql`select auth.update_password(${passwordHash}) as "tokenVersion"`
    );
    return rows[0]?.tokenVersion ?? null;
  });
}

export async function updateUserProfile(params: {
  userId: string;
  name: string;
  email: string;
}) {
  const { userId, name, email } = params;
  return withOrg(userId, async (tx) => {
    const rows = await queryRows<{ id: string; email: string; name: string }>(
      tx,
      sql`select * from auth.update_profile(${name}, ${email})`
    );
    return rows[0] ?? null;
  });
}

export async function softDeleteUser(userId: string) {
  await withOrg(userId, (tx) =>
    tx.execute(sql`select auth.soft_delete_user()`)
  );
}
