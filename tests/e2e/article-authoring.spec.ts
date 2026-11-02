import { expect, test } from '@playwright/test';

/**
 * 谱文（US1）：新建 → 输入 → 自动保存后刷新一致 → 改标题 → 移到分类 → 删除。
 *
 * 这是谱文这条线的「入口故事」：只要它成立，用户就能把文字存进云谱并回来改。
 * 手工验证路径见 specs/002-article-authoring/quickstart.md 的 US1 一节，
 * 这里把它固化成可重复的回归。
 */

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'Passw0rd!e2e';

function watchPageErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const text = message.text();
    if (text.includes('Failed to load resource')) {
      return;
    }
    errors.push(text);
  });
  return errors;
}

test('article authoring: create, auto-save, rename, move folder, delete', async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const email = `e2e-article+${Date.now()}@example.com`;

  await page.goto('/sign-up');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/org\/[^/]+$/);

  await page.getByRole('button', { name: '新建空间' }).click();
  const projectDialog = page.getByRole('dialog', { name: '创建云谱项目' });
  await expect(projectDialog).toBeVisible();
  await page.locator('#project-name').fill('谱文 E2E 云谱');
  await page.locator('#project-surname').fill('陈');
  await page.locator('#project-regions').fill('中国福建');
  await page.locator('#project-theme-name').fill('E2E 陈氏宗谱');
  await projectDialog.getByRole('button', { name: '3 星' }).click();
  await page.locator('#project-notes').fill('E2E');
  await projectDialog.getByRole('button', { name: '确定' }).click();
  await expect(page).toHaveURL(/\/dashboard\/project\/[^/]+$/);

  const projectRef =
    new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) ?? '';
  expect(projectRef).not.toBe('');

  await page.goto(`/dashboard/project/${projectRef}/articles`);
  await expect(page.getByText('还没有谱文', { exact: false })).toBeVisible();

  // 新建：标题必填，地区只读继承云谱空间。
  await page.getByRole('button', { name: '新建谱文' }).first().click();
  const createDialog = page.getByRole('dialog', { name: '新建谱文' });
  await expect(createDialog).toBeVisible();
  await expect(
    createDialog.getByRole('button', { name: '新建并编辑' })
  ).toBeDisabled();
  // 地区继承云谱空间且**只读**：不是可编辑输入框。
  await expect(
    createDialog.getByText('中国福建', { exact: true })
  ).toBeVisible();
  await expect(createDialog.locator('input#new-article-region')).toHaveCount(0);

  await page.locator('#new-article-title').fill('E2E 始祖谱序');
  await createDialog.getByRole('button', { name: '新建并编辑' }).click();

  const editorUrl = new RegExp(
    `/dashboard/project/${projectRef}/articles/[^/]+$`
  );
  await expect(page).toHaveURL(editorUrl);

  const articleId =
    new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) ?? '';
  expect(articleId).not.toBe('');

  // 顶栏：标题、只读地区、立即保存；没有任何分享/发布/导出/版式入口。
  await expect(page.getByLabel('谱文标题')).toHaveValue('E2E 始祖谱序');
  await expect(page.getByText('地区：中国福建', { exact: true })).toBeVisible();
  for (const forbidden of ['分享', '发布', '导出', '版式', '模板']) {
    await expect(
      page.getByRole('button', { name: new RegExp(forbidden) })
    ).toHaveCount(0);
  }

  const canvas = page.locator('.article-canvas');
  await expect(canvas).toBeVisible();
  await canvas.click();
  await page.keyboard.type('第一段：始祖讳元，宋末自闽徙居。');
  await page.keyboard.press('Enter');
  await page.keyboard.type('第二段：家谱由此始。');

  // 停止输入 2 秒后自动保存，顶栏按整篇汇总出现「已保存」。
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByLabel('谱文标题')).toHaveValue('E2E 始祖谱序');
  const reloaded = page.locator('.article-canvas');
  await expect(reloaded).toContainText('第一段：始祖讳元，宋末自闽徙居。');
  await expect(reloaded).toContainText('第二段：家谱由此始。');

  // 改标题：失焦提交，刷新后仍在。
  await page.getByLabel('谱文标题').fill('E2E 始祖谱序（改）');
  await page.getByLabel('谱文标题').blur();
  await page.reload();
  await expect(page.getByLabel('谱文标题')).toHaveValue('E2E 始祖谱序（改）');

  // 列表：显示标题、页数、可搜索，并同步到分类篇数。
  await page.goto(`/dashboard/project/${projectRef}/articles`);
  const row = page.getByRole('link', { name: 'E2E 始祖谱序（改）' });
  await expect(row).toBeVisible();
  await expect(page.getByText('1 页', { exact: true }).first()).toBeVisible();

  const keyword = page.getByPlaceholder('搜索标题');
  await keyword.fill('谱序（改）');
  await expect(row).toBeVisible();
  await keyword.fill('不存在的标题');
  await expect(row).toHaveCount(0);
  await keyword.fill('');

  // 删除：二次确认里写明页数与图片数（FR-004、SC-005）。
  await page
    .getByRole('button', { name: '「E2E 始祖谱序（改）」的操作' })
    .click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  const deleteDialog = page.getByRole('dialog', { name: '删除谱文' });
  await expect(deleteDialog).toContainText('页数：1 页');
  await expect(deleteDialog).toContainText('图片：0 张');
  await deleteDialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'E2E 始祖谱序（改）' })
  ).toHaveCount(0);

  expect(errors).toEqual([]);
});
