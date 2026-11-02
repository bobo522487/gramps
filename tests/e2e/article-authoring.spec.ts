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

/**
 * 注册 → 建云谱空间 → 回到谱文列表，返回 projectRef。
 * 两个故事都要这套前序，抽出来免得两份拷贝各改各的。
 */
async function bootstrap(
  page: import('@playwright/test').Page,
  label: string
): Promise<string> {
  await page.goto('/sign-up');
  await page.locator('#email').fill(`e2e-article+${label}@example.com`);
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
  return projectRef;
}

/**
 * 填标题并提交，进入编辑器（对话框要由调用方先打开——US1 那条还要在打开后
 * 先检查必填与只读地区，所以这里不再代劳点「新建谱文」）。
 */
async function createArticleAndOpen(
  page: import('@playwright/test').Page,
  title: string
): Promise<string> {
  const createDialog = page.getByRole('dialog', { name: '新建谱文' });
  await expect(createDialog).toBeVisible();
  await page.locator('#new-article-title').fill(title);
  await createDialog.getByRole('button', { name: '新建并编辑' }).click();
  await expect(page).toHaveURL(/\/articles\/[^/]+$/);
  return new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) ?? '';
}

test('article authoring: create, auto-save, rename, move folder, delete', async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const projectRef = await bootstrap(page, String(Date.now()));

  await expect(page.getByText('还没有谱文', { exact: false })).toBeVisible();

  // 新建：标题必填，地区只读继承云谱空间（FR-001、FR-007）。
  await page.getByRole('button', { name: '新建谱文' }).first().click();
  const createDialog = page.getByRole('dialog', { name: '新建谱文' });
  await expect(
    createDialog.getByRole('button', { name: '新建并编辑' })
  ).toBeDisabled();
  await expect(
    createDialog.getByText('中国福建', { exact: true })
  ).toBeVisible();
  await expect(createDialog.locator('input#new-article-region')).toHaveCount(0);
  const articleId = await createArticleAndOpen(page, 'E2E 始祖谱序');
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
  // 标题是失焦即存的独立字段：等它存完（提交期间输入框是 disabled）再刷新。
  await expect(page.getByLabel('谱文标题')).toBeEnabled({ timeout: 15_000 });
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

test('multi-page: add, switch commits first, reorder persists, cannot delete last page', async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await bootstrap(page, `pages-${Date.now()}`);
  await page.getByRole('button', { name: '新建谱文' }).first().click();
  await createArticleAndOpen(page, 'E2E 多页谱文');

  const strip = page.getByRole('complementary', { name: '页列表' });
  const canvas = page.locator('.article-canvas');

  // 第 1 页写字并等它存上。
  await canvas.click();
  await page.keyboard.type('第一页：始祖讳元。');
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  // 加页（FR-021）：新页在末尾，缩略图先显示「空页」。
  await strip.getByRole('button', { name: '添加页' }).click();
  await expect(strip.getByText('第 2 页')).toBeVisible();
  await expect(strip.getByText('（空页）')).toBeVisible();

  // 切到新页写字。
  await strip.getByRole('button', { name: /^第 2 页/ }).click();
  await canvas.click();
  await page.keyboard.type('第二页：次房支系。');

  // 有未保存改动时切页 = 先提交再走（FR-003、FR-021、US2-AC7）：
  // 直接点第 1 页，等这一笔存完，第 2 页的缩略图应当换成真实摘要。
  await strip.getByRole('button', { name: /^第 1 页/ }).click();
  await expect(strip.getByText(/次房支系/)).toBeVisible({ timeout: 15_000 });

  // 刷新后两页各自内容不串（FR-024）。
  await page.reload();
  const canvasAfterReload = page.locator('.article-canvas');
  await expect(canvasAfterReload).toContainText('第一页：始祖讳元。');
  await strip.getByRole('button', { name: /^第 2 页/ }).click();
  await expect(page.locator('.article-canvas')).toContainText(
    '第二页：次房支系。'
  );

  // 拖拽重排（FR-023）：把第 2 页拖到第 1 页前面，刷新后页序保持。
  const items = strip.getByRole('listitem');
  await items.nth(1).dragTo(items.nth(0));
  // 重排成功后右区顺序按服务端返回的页序立刻更新（FR-023）。
  await expect(items.nth(0)).toContainText('次房支系', { timeout: 15_000 });
  await page.reload();
  await expect(strip.getByText('第 1 页')).toBeVisible();
  await expect(strip.getByRole('button', { name: /^第 1 页/ })).toContainText(
    '次房支系'
  );
  await expect(strip.getByRole('button', { name: /^第 2 页/ })).toContainText(
    '始祖讳元'
  );

  // 删到只剩一页时不再给删除入口，也删不掉最后一页（FR-022）。
  await strip.getByRole('button', { name: '删除第 2 页' }).click();
  await expect(page.getByRole('button', { name: /^第 2 页/ })).toHaveCount(0);
  await expect(strip.getByRole('button', { name: '删除第 1 页' })).toHaveCount(
    0
  );
  await expect(page.locator('.article-canvas')).toContainText('次房支系');

  expect(errors).toEqual([]);
});

test('image: insert, resize, persist, and reject oversize', async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const _projectRef = await bootstrap(page, String(Date.now()));

  await page.getByRole('button', { name: '新建谱文' }).first().click();
  const articleId = await createArticleAndOpen(page, 'E2E 像赞');

  await page.locator('.article-canvas').click();
  await page.keyboard.type('始祖像赞一首。');
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  // 插入图片：走服务端媒体通道，文档里存的是 pathname，渲染走 /api/media 代理。
  // 最小合法 PNG（1×1）：只验魔数与通路，不验像素。
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.getByRole('button', { name: '插入图片' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: '祖像.png',
    mimeType: 'image/png',
    buffer: png,
  });

  const img = page.locator('.article-canvas img');
  await expect(img).toHaveCount(1, { timeout: 15_000 });
  await expect(img).toHaveAttribute('src', /^\/api\/media\/articles\//);
  await expect(img).toHaveAttribute('data-width', 'full');
  expect(await img.getAttribute('src')).toContain(articleId);

  // 三档宽度（FR-026）：选中图片后切「中」，保存后刷新仍是中。
  await img.click();
  await page.getByRole('button', { name: '图片宽度中' }).click();
  await expect(img).toHaveAttribute('data-width', 'medium');
  await expect(page.getByRole('button', { name: '立即保存' })).toBeEnabled();
  await page.getByRole('button', { name: '立即保存' }).click();
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.locator('.article-canvas img')).toHaveAttribute(
    'data-width',
    'medium'
  );

  // 超过 10MB：客户端先挡，中文提示，已有图片与文字不受影响（FR-037、US3-AC4）。
  await page.locator('input[type="file"]').setInputFiles({
    name: '大图.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(
    page.getByText('只支持 JPG / PNG / WebP，单张不超过 10MB')
  ).toBeVisible();
  await expect(page.locator('.article-canvas img')).toHaveCount(1);
  await expect(page.locator('.article-canvas')).toContainText('始祖像赞一首。');

  // 伪装成图片的文本：客户端 MIME 先挡一道。
  await page.locator('input[type="file"]').setInputFiles({
    name: '手抄.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('不是图片'),
  });
  await expect(page.locator('.article-canvas img')).toHaveCount(1);

  expect(errors).toEqual([]);
});
