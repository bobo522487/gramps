// Shared types for Server Action state. Kept free of server-only imports so
// client components can depend on it without pulling in `server-only` modules.

/** The only user fields safe to serialize to the browser. */
export type SessionUser = {
  id: string;
  name: string | null;
  email: string;
};

/**
 * Server Action 的返回值。`T` 是成功时携带的结构化载荷（编辑器需要保存时间、
 * 服务端回显的页等）；默认 `undefined`，所以既有 30 个 Action 与表单组件里
 * `ActionState` 的写法一个字都不用改（[ADR 0009 §1] 的最小改动口径）。
 */
export type ActionState<T = undefined> = {
  error?: string;
  /** Stable machine-readable error code, e.g. `UNAUTHORIZED`. */
  code?: string;
  success?: string;
  email?: string;
  /** Validation messages keyed by form field name (e.g. `email`). */
  fieldErrors?: Record<string, string>;
  /** 成功时的结构化载荷；只在 `error` 缺失时读取。 */
  data?: T;
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
