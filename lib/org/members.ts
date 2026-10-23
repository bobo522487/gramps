import 'server-only';

import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/better-auth';

export type OrgMemberView = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
};

/** Org members come from Better Auth so its adapter stays the single writer. */
export async function listOrgMembers(
  organizationId: string
): Promise<OrgMemberView[]> {
  const result = await getAuth().api.listMembers({
    query: { organizationId },
    headers: await headers(),
  });

  return result.members.map((member) => ({
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    joinedAt: member.createdAt.toISOString(),
  }));
}
