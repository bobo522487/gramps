// Shared types for Server Action state. Kept free of server-only imports so
// client components can depend on it without pulling in `server-only` modules.

/** The only user fields safe to serialize to the browser. */
export type SessionUser = {
  id: string;
  name: string | null;
  email: string;
};

export type ActionState = {
  error?: string;
  /** Stable machine-readable error code, e.g. `UNAUTHORIZED`. */
  code?: string;
  success?: string;
  email?: string;
  /** Validation messages keyed by form field name (e.g. `email`). */
  fieldErrors?: Record<string, string>;
  name?: string;
  orgId?: string;
  orgSlug?: string;
  projectId?: string;
  projectRef?: string;
  folderId?: string;
  lineageId?: string;
  nodeId?: string;
  spouseId?: string;
  /** One-time sign-up/accept link shown to the inviter. */
  inviteUrl?: string;
};
