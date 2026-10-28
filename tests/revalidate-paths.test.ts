import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { revalidatePath } = await import('next/cache');
const { revalidateOrg, revalidateProject, revalidateWholeConsole } =
  await import('@/lib/lineage/revalidate');

const ORG_SLUG = 'orgslug123451789abc';
const PROJECT_REF = 'projref123456789abc';

/**
 * 这里只测 helper 本身的形状。**生产调用点仍然全部走 revalidateWholeConsole()**，
 * 所以下面两个 scoped helper 是零调用者的待接线代码——最后一例把这件事钉住，
 * 免得文档再次把它写成「已收窄」（真的接线那天这条会红，是预期信号）。
 */
describe('revalidate helpers', () => {
  it('revalidateProject 失效该project 与所属组织两棵子树', () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateProject(ORG_SLUG, PROJECT_REF);

    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/project/${PROJECT_REF}`,
      'layout'
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/org/${ORG_SLUG}`,
      'layout'
    );
  });

  it('revalidateOrg 只失效该组织一棵子树', () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateOrg(ORG_SLUG);

    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/org/${ORG_SLUG}`,
      'layout'
    );
  });

  it('revalidateWholeConsole 失效整棵 /dashboard 树', () => {
    vi.mocked(revalidatePath).mockClear();
    revalidateWholeConsole();

    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard', 'layout');
  });

  it('scoped helpers 尚未接线：写入 Action 里没有一处调用', () => {
    const actionFiles = [
      'lib/lineage/actions.ts',
      'lib/folder/actions.ts',
      'lib/project/actions.ts',
      'lib/org/actions.ts',
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
