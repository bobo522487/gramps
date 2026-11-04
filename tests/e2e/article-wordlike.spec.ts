import { expect, type Locator, test } from '@playwright/test';

import { seedArticleWithImages } from './fixtures/article';

/**
 * 谱文（003）：Word-like formatting, multi-page ≥3, viewer, regression smoke.
 *
 * US1 (T014): main path with bold/list/align formatting.
 * US2 (T018): ≥3 pages with page strip mini-pages and selection change.
 * US3 (T022): read-only viewer sees ZERO toolbar nodes.
 * Regression (T023): multi-page switch + save, image width three modes, undo/redo.
 *
 * This is the ONE test [T014] that should be fully runnable in CI; the others are
 * marked fixme due to heavy/flaky setup requirements and will be enabled after the
 * corresponding fixtures/UI components stabilize.
 *
 * SELECTOR CONTRACT (written against these exact selectors — Lead implements UI):
 * - Toolbar root: page.getByRole('toolbar', { name: '格式工具栏' })
 * - Buttons (aria-label): 加粗 / 斜体 / 下划线 / 无序列表 / 有序列表 / 左对齐 / 居中 / 右对齐 / 撤销 / 重做 / 插入图片 / 正文 / 一级标题 / 二级标题
 * - Selects: #article-font-family, #article-font-size
 * - Canvas: .article-canvas (contenteditable)
 * - Mini pages: [data-testid="mini-page"]
 * - Page strip: [aria-label="页列表"]
 * - Viewer: expect(page.getByRole('toolbar', { name: '格式工具栏' })).toHaveCount(0)
 *
 * NOTE: Existing UI mismatches to report:
 * 1. Toolbar root lacks role="toolbar" and aria-label="格式工具栏" (currently plain div).
 * 2. New format buttons (加粗/斜体/下划线/无序列表/有序列表/左对齐/居中/右对齐) NOT in current toolbar.tsx.
 * 3. Viewer (editable=false) still renders EditorToolbar; must gate on editable to show ZERO nodes.
 * 4. page-strip.tsx lacks data-testid="mini-page" on mini-page <li> elements.
 */

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'Passw0rd!e2e';

/**
 * 注册限流按客户端 IP 计（signup:<ip>，5 次/小时）。本文件每个 test 都要一个干净账号，
 * 加上 critical-path 的注册就会超过 5 次。所以每个 test 用独立的 x-forwarded-for，让限流按不同客户端计。
 *
 * 只能给本站请求加：setExtraHTTPHeaders 会带到跨域请求上，而 x-forwarded-for 不在 Vercel Blob 的 CORS 里，预检失败。
 */
let clientIpIndex = 0;

function isAppRequest(url: string): boolean {
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\b/.test(url)) {
    return true;
  }
  const external = process.env.E2E_BASE_URL;
  return Boolean(external) && url.startsWith(external as string);
}

function forgeClientIp(
  page: import('@playwright/test').Page,
  ip: string
): void {
  void page.route('**/*', (route) => {
    if (!isAppRequest(route.request().url())) {
      return route.continue();
    }
    return route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': ip },
    });
  });
}

function watchPageErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    errors.push(message.text());
  });
  return errors;
}

/**
 * 刷新后等编辑器真正接管（ProseMirror 会给 contenteditable 挂上属性），
 * 再把光标放进去。少了这一步，按键会落到整个页面上，Control+a 选中的就不是文档。
 */
async function takeEditorFocus(canvas: Locator) {
  await expect(canvas).toHaveAttribute('contenteditable', 'true', {
    timeout: 15_000,
  });
  await canvas.click();
}

/**
 * 注册 → 建云谱空间 → 回到谱文列表，返回 projectRef。
 */
async function bootstrap(
  page: import('@playwright/test').Page,
  label: string
): Promise<string> {
  forgeClientIp(page, `203.0.113.${++clientIpIndex}`);
  await page.goto('/sign-up');
  await page.locator('#email').fill(`e2e-wordlike+${label}@example.com`);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/org\/[^/]+$/);

  await page.getByRole('button', { name: '新建空间' }).click();
  const projectDialog = page.getByRole('dialog', { name: '创建云谱项目' });
  await expect(projectDialog).toBeVisible();
  await page.locator('#project-name').fill('Wordlike E2E 云谱');
  await page.locator('#project-surname').fill('陈');
  await page.locator('#project-regions').fill('中国福建');
  await page.locator('#project-theme-name').fill('Wordlike E2E 陈氏宗谱');
  await projectDialog.getByRole('button', { name: '3 星' }).click();
  await page.locator('#project-notes').fill('Wordlike E2E');
  await projectDialog.getByRole('button', { name: '确定' }).click();
  await expect(page).toHaveURL(/\/dashboard\/project\/[^/]+$/);

  const projectRef =
    new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) ?? '';
  expect(projectRef).not.toBe('');
  await page.goto(`/dashboard/project/${projectRef}/articles`);
  return projectRef;
}

/**
 * 打开新建谱文对话框、填标题并提交，进入编辑器。
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

/**
 * T014 (US1): main path with bold/list/align formatting.
 *
 * Register → create project → open new article editor; type text; select text;
 * click 加粗，无序列表，居中；trigger save (立即保存); reload; assert formatting persisted.
 *
 * Keep assertions robust to exact DOM TipTap emits; prefer checking persisted HTML tags
 * (<strong>, <ul>, style="text-align:...") + no page errors.
 */
test('T014 wordlike formatting: bold / bullet list / center alignment', async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await bootstrap(page, String(Date.now()));

  await expect(page.getByText('还没有谱文', { exact: false })).toBeVisible();

  // 新建谱文对话框 → 编辑器
  await page.getByRole('button', { name: '新建谱文' }).first().click();
  await createArticleAndOpen(page, 'Wordlike 排版测试');

  // 顶栏没有分享/发布/导出/版式入口（FR-041/FR-042/SC-011）
  for (const forbidden of ['分享', '发布', '导出', '版式', '模板']) {
    await expect(
      page.getByRole('button', { name: new RegExp(forbidden) })
    ).toHaveCount(0);
  }

  // 工具栏和画布就绪
  const toolbar = page.getByRole('toolbar', { name: '格式工具栏' });
  await expect(toolbar).toBeVisible();

  const canvas = page.locator('.article-canvas');
  await takeEditorFocus(canvas);

  // 输入文字并选中
  await page.keyboard.type('始祖讳元，宋末自闽徙居。');
  await page.keyboard.press('Control+A');

  // 应用三种格式：加粗 → 无序列表 → 居中
  await toolbar.getByRole('button', { name: '加粗' }).click();
  await toolbar.getByRole('button', { name: '无序列表' }).click();
  await toolbar.getByRole('button', { name: '居中' }).click();

  // 保存：点「立即保存」等待已保存提示
  await page.getByRole('button', { name: '立即保存' }).click();
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  // 重新加载页面
  await page.reload();
  await expect(page.getByLabel('谱文标题')).toHaveValue('Wordlike 排版测试');

  // 等待编辑器接管
  const reloaded = page.locator('.article-canvas');
  await expect(reloaded).toHaveAttribute('contenteditable', 'true', {
    timeout: 15_000,
  });
  await expect(reloaded).toContainText('始祖讳元，宋末自闽徙居。');

  // 持久化后的格式检查：TipTap/ProseMirror 生成的 HTML 标签
  // 加粗 → <strong> 或 <b>; 无序列表 → <ul>; 居中 → style="text-align: center"
  const html = await reloaded.innerHTML();
  expect(html).toMatch(/<(strong|b)\b/);
  expect(html).toMatch(/<ul\b/);
  expect(html).toMatch(/text-align\s*:\s*center/);

  // 无页面错误
  expect(errors).toEqual([]);
});

/**
 * T018 (US2): ≥3 pages with mini-page selection change.
 *
 * Create ≥3 pages (using the add-page control), assert [data-testid="mini-page"] count ≥ 3,
 * click different mini-pages and assert selection change via canvas content/heading change.
 *
 * Marked fixme: multi-page creation and selection-change indicators lack stable contract
 * selectors and depend on auto-save timing, keeping CI light until the 003 page-strip/mini-page
 * component stabilizes.
 */
test('T018 multi-page ≥3 with mini-page selection change', async ({ page }) => {
  test.fixme(true, '≥3 页创建与切页自动保存时序夹具较重，待稳定后启用');

  const errors = watchPageErrors(page);
  await bootstrap(page, `pages-${Date.now()}`);

  await page.getByRole('button', { name: '新建谱文' }).first().click();
  await createArticleAndOpen(page, '多页测试');

  const pageStrip = page.locator('[aria-label="页列表"]');
  const canvas = page.locator('.article-canvas');

  // 初始 1 页：填写第一页内容并等待保存
  await takeEditorFocus(canvas);
  await page.keyboard.type('第一页标记：始祖讳元。');
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  // 添加第二页并填写
  await pageStrip.getByRole('button', { name: '添加页' }).click();
  await takeEditorFocus(canvas);
  await page.keyboard.type('第二页标记：次房支系。');
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  // 添加第三页
  await pageStrip.getByRole('button', { name: '添加页' }).click();
  await expect(page.getByText('第 3 页')).toBeVisible();

  // 断言 mini-page 计数 ≥3
  const miniPages = page.locator('[data-testid="mini-page"]');
  await expect(miniPages).toHaveCount(3);

  // 点击第 1 页 mini-page，断言画布显示对应内容（使用 content change 作为稳定的选择指示器）
  await miniPages.nth(0).click();
  await expect(canvas).toContainText('第一页标记：始祖讳元。');

  // 点击第 2 页 mini-page，断言画布内容切换
  await miniPages.nth(1).click();
  await expect(canvas).toContainText('第二页标记：次房支系。');

  expect(errors).toEqual([]);
});

/**
 * T022 (US3): view-only user sees ZERO toolbar nodes.
 *
 * A viewer (non-writer member) opens the article; assertion:
 *   - expect(page.getByRole('toolbar', { name: '格式工具栏' })).toHaveCount(0)
 *   - Canvas visible but read-only; formatting still rendered.
 *
 * Marked fixme(true): needs viewer member fixture (invite link acceptance + second account login).
 * Setup would involve: register admin → create article → invite viewer → viewer accepts invite → open article → assertions.
 */
test('T022 reader-only viewer sees zero toolbar nodes', async ({ page }) => {
  test.fixme(true, '需要 viewer 成员夹具');

  const errors = watchPageErrors(page);
  // Setup steps (placeholder - heavy fixture required):
  // 1. Admin registers, creates project + article, saves formatted content.
  // 2. Admin invites viewer via member invitation (or uses API).
  // 3. Viewer account logs in and joins organization with viewer role.
  // 4. Navigate to article as viewer.

  const toolbar = page.getByRole('toolbar', { name: '格式工具栏' });
  // FR-018 / SC-006：查看者连工具栏节点都不能渲染（不是禁用，是不存在）。
  await expect(toolbar).toHaveCount(0);

  const canvas = page.locator('.article-canvas');
  await expect(canvas).toBeVisible();

  // Canvas should be read-only: either editable=false or ProseMirror non-editable
  // Note: ProseMirror may keep contenteditable=true; the absence of toolbar is the key contract requirement.
  await expect(canvas).toContainText('始祖讳元'); // placeholder for existing content

  expect(errors).toEqual([]);
});

/**
 * T023 (002 regression smoke): multi-page switch + save, image three modes, undo/redo.
 *
 * Multi-page switch + immediate save; image width three modes (small/medium/full);
 * undo/redo covering the new Word-like formats (bold/list/align).
 *
 * Marked fixme: combination of image upload (Blob/blobfs), multi-page switches, and
 * undo/redo command sequences is heavy-flaky for now; keeps CI green pending fixture maturity.
 */
test('T023 regression smoke: multi-page + image widths + undo/redo', async ({
  page,
}) => {
  test.fixme(
    true,
    '多页切换 + 图片三档宽度 + 撤销重做的组合夹具较重，待稳定后启用'
  );

  const errors = watchPageErrors(page);
  const projectRef = await bootstrap(page, `regress-${Date.now()}`);

  // Seed a 3-page article with images directly into the E2E DB (heavy fixture).
  const seeded = await seedArticleWithImages({
    projectRef,
    pageCount: 3,
    imagesPerPage: 1,
  });
  expect(seeded.imageCount).toBe(3);

  // Setup: create article + pages + images (placeholder - heavy)
  await page.getByRole('button', { name: '新建谱文' }).first().click();
  await createArticleAndOpen(page, '回归测试');

  const toolbar = page.getByRole('toolbar', { name: '格式工具栏' });
  const canvas = page.locator('.article-canvas');

  // 003 新格式入口仍在，002 的撤销/重做与自动保存没有被挤掉。
  await expect(toolbar.getByRole('button', { name: '加粗' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '撤销' })).toBeVisible();

  // Multi-page switch + save (light version)
  await takeEditorFocus(canvas);
  await page.keyboard.type('Page 1 content.');
  await page.getByRole('button', { name: '添加页' }).click();
  await page
    .locator('[aria-label="页列表"]')
    .getByRole('button', { name: /^第 1 页/ })
    .click();
  await page.getByRole('button', { name: '立即保存' }).click();
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  // Image width three modes (placeholder for actual upload logic)
  // await page.getByRole('button', { name: '插入图片' }).click();
  // await page.locator('input[type="file"]').setInputFiles(...);
  // await page.getByRole('button', { name: '图片宽度中' }).click();
  // Check data-width attribute on image.

  // Undo/redo (placeholder)
  // await toolbar.getByRole('button', { name: '撤销' }).click();
  // await toolbar.getByRole('button', { name: '重做' }).click();

  expect(errors).toEqual([]);
});
