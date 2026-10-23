import 'server-only';

import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/better-auth';
import { authErrorMessage } from '@/lib/auth/errors';

export type InvitationDetails = {
  id: string;
  organizationName: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
};

export type InvitationLookup =
  | { ok: true; invitation: InvitationDetails }
  | { ok: false; error: string };

/**
 * Validates the invitation against the signed-in account before the join page
 * renders. Better Auth rejects expired, processed and mismatched invitations.
 */
export async function getInvitationDetails(
  invitationId: string
): Promise<InvitationLookup> {
  try {
    const invitation = await getAuth().api.getInvitation({
      query: { id: invitationId },
      headers: await headers(),
    });

    return {
      ok: true,
      invitation: {
        id: invitation.id,
        organizationName: invitation.organizationName,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: new Date(invitation.expiresAt).toISOString(),
      },
    };
  } catch (error) {
    const status =
      typeof error === 'object' && error !== null
        ? ((error as { status?: unknown; statusCode?: unknown }).status ??
          (error as { statusCode?: unknown }).statusCode)
        : null;
    return {
      ok: false,
      error: status === 400 ? '邀请无效或已过期。' : authErrorMessage(error),
    };
  }
}
