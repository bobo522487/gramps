import 'server-only';

import { revalidatePath } from 'next/cache';

/**
 * 当前所有写入的失效入口：根布局读会话与组织列表，控制台切换器跨 org/project，
 * 所以整棵树都要失效。
 *
 * 按子树收窄需要 Action 的 Zod 入参带上公开 `orgSlug` / `projectRef`（现在只有 UUID），
 * 是已知代码任务；不为它预置零调用 helper（2026-11-05 减法，接线的那天再按入参实装）。
 *
 * 为什么收窄现在不值得优先做：`pnpm build` 的路由全是 `ƒ (Dynamic)`，没有预渲染 HTML
 * 可被「炸掉」，整树失效的代价落在客户端 Router Cache（下次导航重新拉 RSC payload），
 * 不是服务端重渲染。等路由真的静态化或被缓存之后，再回到这里。
 *
 * 本文件属于控制台横切能力，不属于谱系域——认证 / 组织 / 项目 / 分类 / 谱文 / 谱系
 * 的写 Action 都从这里 import。
 */
export function revalidateWholeConsole() {
  revalidatePath('/dashboard', 'layout');
}
