import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { revalidatePath } = await import('next/cache');
const { revalidateWholeConsole } = await import('@/lib/console/revalidate');

/**
 * 唯一存活的失效入口及其调用点。曾经有两个 scoped helper（按 project / org 子树收窄），
 * 零调用者、只在测试里被引用；2026-11-05 按「只做减法」删掉，需要时随 Zod 入参一起实装。
 */
describe('revalidate helpers', () => {
  it('revalidateWholeConsole 失效整棵 /dashboard 树', () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateWholeConsole();

    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard', 'layout');
  });

  it('写入 Action 全部走统一入口，不引用已删除的 scoped helper', () => {
    const actionFiles = [
      'lib/lineage/actions.ts',
      'lib/folder/actions.ts',
      'lib/project/actions.ts',
      'lib/org/actions.ts',
      'lib/article/actions.ts',
      'lib/auth/actions/account.ts',
    ];
    const sources = actionFiles
      .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join('\n');

    const wholeConsoleCalls =
      sources.match(/revalidateWholeConsole\(\)/g) ?? [];

    expect(wholeConsoleCalls.length).toBeGreaterThan(0);
    expect(sources).not.toMatch(/revalidateProject\(/);
    expect(sources).not.toMatch(/revalidateOrg\(/);
  });
});
