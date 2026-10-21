// Shared types for Server Action state. Kept free of server-only imports so
// client components can depend on it without pulling in `server-only` modules.

/** The only user fields safe to serialize to the browser. */
export type SessionUser = {
  id: number;
  name: string | null;
  email: string;
};

export type ActionState = {
  error?: string;
  success?: string;
  email?: string;
  /** Validation messages keyed by form field name (e.g. `email`). */
  fieldErrors?: Record<string, string>;
  name?: string;
  orgId?: number;
  orgSlug?: string;
  projectId?: number;
  projectRef?: string;
};
