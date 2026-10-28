import 'server-only';

import { revalidatePath } from 'next/cache';

/**
 * 现状（由 `tests/revalidate-paths.test.ts` 钉住）：25 处写入 Action 全部只调
 * `revalidateWholeConsole()`；下面两个 scoped helper **尚未接线**，因为 Action 的
 * Zod 入参只有 UUID `orgId` / `lineageId` / `projectId`，拿不到路径需要的公开
 * `orgSlug` / `projectRef`。接线要同时改 schema 与提交它们的对话框，属于评审 P1-8，
 * 在那之前不要假设失效是收窄的。
 *
 * 为什么这件事现在不值得优先做：`pnpm build` 的 21 条路由全是 `ƒ (Dynamic)`，
 * `○ (Static)` 为 0，`prerender-manifest.json` 里只有 `/_global-error` 与
 * `/favicon.ico`。也就是说服务端没有预渲染 HTML 可被「炸掉」，整树失效的代价落在
 * 客户端 Router Cache（下次导航重新拉 RSC payload），不是服务端重渲染。等路由真的
 * 静态化或被缓存之后，再回到这里收窄。
 */

/** A lineage / node / folder write: only this project and its org shell change. */
export function revalidateProject(orgSlug: string, projectRef: string) {
  revalidatePath(`/dashboard/project/${projectRef}`, 'layout');
  revalidatePath(`/dashboard/org/${orgSlug}`, 'layout');
}

/** An organization-scoped write that cannot affect another project's contents. */
export function revalidateOrg(orgSlug: string) {
  revalidatePath(`/dashboard/org/${orgSlug}`, 'layout');
}

/**
 * 当前所有写入的失效入口：根布局读会话与组织列表，控制台切换器跨 org/project，
 * 所以整棵树都要失效。
 */
export function revalidateWholeConsole() {
  revalidatePath('/dashboard', 'layout');
}
