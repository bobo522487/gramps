import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { setLogContextProvider } from '@/lib/logger';

export type RequestLogContext = {
  request_id?: string;
  method?: string;
  path?: string;
  user_id?: number;
  org_id?: number;
  duration_ms?: number;
};

const storage = new AsyncLocalStorage<RequestLogContext>();

// Registration happens on import; importing this module from a server entry
// point is what enables automatic request context in logs.
setLogContextProvider(() => storage.getStore());

export function runWithRequestContext<T>(
  context: RequestLogContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run({ ...context }, fn);
}

/** Adds fields to the active request's log context; no-op outside a request. */
export function addLogContext(context: Partial<RequestLogContext>) {
  const store = storage.getStore();
  if (store) {
    Object.assign(store, context);
  }
}

export function getRequestContext(): RequestLogContext | undefined {
  return storage.getStore();
}
