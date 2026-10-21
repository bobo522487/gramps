import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUser } from '@/lib/db/queries';
import { users } from '@/lib/db/schema';
import { signSessionFor } from '../helpers/auth';
import { getTestDb } from '../helpers/db';
import { createUser } from '../helpers/factories';

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name !== 'session' || !session.token) {
        return undefined;
      }
      return { name, value: session.token };
    },
  }),
}));

beforeEach(() => {
  session.token = undefined;
});

describe('getUser against PostgreSQL', () => {
  it('returns the user when the session token version matches', async () => {
    const user = await createUser();
    session.token = await signSessionFor(user.id, user.tokenVersion);

    const resolved = await getUser();

    expect(resolved?.id).toBe(user.id);
    expect(resolved?.email).toBe(user.email);
  });

  it('returns null after the token version is bumped', async () => {
    const user = await createUser();
    session.token = await signSessionFor(user.id, user.tokenVersion + 1);

    expect(await getUser()).toBeNull();
  });

  it('returns null for a soft-deleted user', async () => {
    const user = await createUser();
    await getTestDb()
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, user.id));
    session.token = await signSessionFor(user.id, user.tokenVersion);

    expect(await getUser()).toBeNull();
  });

  it('returns null for a user that no longer exists', async () => {
    session.token = await signSessionFor(999_999, 0);

    expect(await getUser()).toBeNull();
  });

  it('returns null when the session cookie is absent', async () => {
    expect(await getUser()).toBeNull();
  });
});
