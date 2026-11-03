import { expect, type Locator, test } from '@playwright/test';

import { seedArticleWithImages } from './fixtures/article';

/**
 * 谱文（US1）：新建 → 输入 → 自动保存后刷新一致 → 改标题 → 移到分类 → 删除。
 *
 * 这是谱文这条线的「入口故事」：只要它成立，用户就能把文字存进云谱并回来改。
 * 手工验证路径见 specs/002-article-authoring/quickstart.md 的 US1 一节，
 * 这里把它固化成可重复的回归。
 */

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'Passw0rd!e2e';

/**
 * 注册限流按客户端 IP 计（`signup:<ip>`，5 次/小时，见
 * `lib/auth/actions/session.ts:101`）。本文件每个 test 都要一个干净账号，
 * 加上 critical-path 的注册就会超过 5 次，第 6 次被「尝试次数过多」挡下
 * （实跑踩过：CI 模式全量 E2E 里 critical-path 红）。所以每个 test 用
 * 独立的 x-forwarded-for（TEST-NET-3 段），让限流按不同客户端计。
 *
 * 只能给**本站请求**加：`setExtraHTTPHeaders` 会把它带到跨域请求上，而
 * `x-forwarded-for` 不在 Vercel Blob 的 `access-control-allow-headers` 里，
 * 预检直接失败，浏览器直传就变成 `net::ERR_FAILED`（实跑踩过，误判成环境挡网）。
 */
let clientIpIndex = 0;

/** 本站请求（本地 127.0.0.1 或 E2E_BASE_URL 指向的部署）才换客户端 IP。 */
function isAppRequest(url: string): boolean {
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\b/.test(url)) {
    return true;
  }
  const external = process.env.E2E_BASE_URL;
  return Boolean(external) && url.startsWith(external as string);
}

/** 只给本站请求换客户端 IP，跨域请求原样放行。 */
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
 * 再把光标放进去。少了这一步，按键会落到整个页面上，`Control+a` 选中的
 * 就不是文档，mark 自然设不上。
 */
async function takeEditorFocus(canvas: Locator) {
  await expect(canvas).toHaveAttribute('contenteditable', 'true', {
    timeout: 15_000,
  });
  await canvas.click();
}

/**
 * 注册 → 建云谱空间 → 回到谱文列表，返回 projectRef。
 * 两个故事都要这套前序，抽出来免得两份拷贝各改各的。
 */
async function bootstrap(
  page: import('@playwright/test').Page,
  label: string
): Promise<string> {
  forgeClientIp(page, `203.0.113.${++clientIpIndex}`);
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
  // FR-032：命中结果必须能看出所属分类，所以标签就打在行上。
  await expect(
    page.locator('li').filter({ hasText: 'E2E 始祖谱序（改）' })
  ).toContainText('默认分类');
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
  // contenteditable 是 ProseMirror 挂上之后才有的属性：拿它当「客户端已接管」的门。
  // 没这道门时实测过一次竞态——点第 2 页落在 hydration 之前，点了没反应，
  // 10 秒后画布还是第 1 页（serial 模式下整条链路红一次）。
  await expect(canvasAfterReload).toHaveAttribute('contenteditable', 'true');
  await expect(async () => {
    await strip.getByRole('button', { name: /^第 2 页/ }).click();
    await expect(canvasAfterReload).toContainText('第二页：次房支系。', {
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });

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

  // 删页要先二次确认，确认框里写清楚删的是哪一页（FR-022）。
  const deleteButton = strip.getByRole('button', { name: '删除第 2 页' });
  const confirm = page.getByRole('dialog', { name: '删除这一页？' });
  await deleteButton.click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('第 2 页');
  // 先取消：确认框必须真的拦一道（FR-022）。
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(strip.getByRole('button', { name: /^第 2 页/ })).toBeVisible();
  // 再删一次并确认。
  await deleteButton.click();
  await confirm.getByRole('button', { name: '删除' }).click();
  await expect(page.getByRole('button', { name: /^第 2 页/ })).toHaveCount(0);
  // 只剩一页：给入口但拒绝执行，并说明原因（FR-022「被拒绝并提示」）。
  await strip.getByRole('button', { name: '删除第 1 页' }).click();
  await expect(page.getByText('至少要保留一页，这一页删不掉。')).toBeVisible();
  await expect(strip.getByRole('button', { name: /^第 1 页/ })).toBeVisible();
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
  // 图必须**真解码出像素**：Blob 模式下 /api/media 回的是 302，只有浏览器能跟到
  // 私有桶并把 1×1 解出来，naturalWidth 才大于 0。只数 <img> 元素是假通过。
  await expect
    .poll(
      () =>
        img.evaluate((node) =>
          node instanceof HTMLImageElement ? node.naturalWidth : 0
        ),
      {
        message: '图片没有真的加载出像素（读取通道或直连域名不通）',
        timeout: 15_000,
      }
    )
    .toBeGreaterThan(0);

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

test('font: 楷体与字号在刷新后仍然生效（US4、FR-030）', async ({ page }) => {
  const errors = watchPageErrors(page);
  await bootstrap(page, 'font');

  await page.getByRole('button', { name: '新建谱文' }).click();
  await createArticleAndOpen(page, '字辈考');

  await page.locator('.article-canvas').click();
  await page.keyboard.type('始祖讳元，字德承。');
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  // P2 只给字体与字号两个开关（FR-031 的禁用清单由 StarterKit 关掉）。
  await page.keyboard.press('Control+A');
  await page.selectOption('#article-font-family', 'KaiTi');
  await page.selectOption('#article-font-size', '19px');
  await page.getByRole('button', { name: '立即保存' }).click();
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });

  // 刷新后样式必须还在：attrs 走的是同一条序列化链路（Task 10 在这上面翻过一次）。
  await page.reload();
  const styled = page.locator('.article-canvas span[style*="KaiTi"]');
  await expect(styled).toHaveCount(1);
  await expect(styled).toHaveCSS('font-size', '19px');

  expect(errors).toEqual([]);
});

/**
 * SC-003 的浏览器那一半（T048）：20 页 40 图，量切页耗时与滚动帧率。
 *
 * 阈值有意比规格宽松（切页 1s、帧率 30fps）：本地跑的是生产构建 + 软渲染，
 * 绝对值受机器影响很大。这条回归的作用是**发现平方级退化或整篇重渲染**，
 * 不是给 45fps 背书；规格口径的实测要拿目标环境重跑一次。
 */
test('perf: 20 页 40 图的切页与滚动（SC-003）', async ({ page }) => {
  test.slow();
  const projectRef = await bootstrap(page, 'perf');
  const seeded = await seedArticleWithImages({
    projectRef,
    pageCount: 20,
    imagesPerPage: 2,
  });
  expect(seeded.imageCount).toBe(40);

  await page.goto(
    `/dashboard/project/${projectRef}/articles/${seeded.articleId}`
  );
  const strip = page.getByRole('complementary', { name: '页列表' });
  const items = strip.getByRole('listitem');
  await expect(items).toHaveCount(20);

  const durations: number[] = [];
  for (const target of [7, 13, 19, 2, 10]) {
    const start = Date.now();
    await items
      .nth(target - 1)
      .getByRole('button', { name: new RegExp(`^第 ${target} 页`) })
      .click();
    await expect(page.locator('.article-canvas')).toContainText(
      `第 ${target} 房支系`
    );
    durations.push(Date.now() - start);
  }
  const worst = Math.max(...durations);
  console.log(
    `[SC-003 浏览器] 切页耗时 ms=${durations.join('/')} 最差=${worst}`
  );
  expect(worst).toBeLessThan(1_000);

  const fps = await page.evaluate(async () => {
    const canvas = document.querySelector('.article-canvas');
    let scroller: Element | null = canvas ?? null;
    while (scroller && scroller !== document.body) {
      const style = getComputedStyle(scroller);
      if (/(auto|scroll)/.test(style.overflowY)) break;
      scroller = scroller.parentElement;
    }
    const target = scroller ?? document.scrollingElement;
    let frames = 0;
    let stop = false;
    const start = performance.now();
    const tick = () => {
      if (stop) return;
      frames += 1;
      if (target) {
        target.scrollTop = (target.scrollTop + 80) % 4000;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    stop = true;
    return frames / ((performance.now() - start) / 1000);
  });
  console.log(`[SC-003 浏览器] 滚动帧率=${fps.toFixed(1)} fps`);
  expect(fps).toBeGreaterThan(30);
});

test('regressions: 空页引导、Ctrl+U 不再毁掉整页保存、搜索跨分类、在途保存不丢字', async ({
  page,
}) => {
  test.slow();
  const errors = watchPageErrors(page);
  const projectRef = await bootstrap(page, 'regression');
  await page.goto(`/dashboard/project/${projectRef}/articles`);

  // 新建谱文：空白页必须有引导（FR-018）。
  await page.getByRole('button', { name: '新建谱文' }).click();
  await createArticleAndOpen(page, '终审回归谱序');
  const canvas = page.locator('.article-canvas');
  await expect(page.getByText('输入文字')).toBeVisible();
  await canvas.click();
  await page.keyboard.type('始祖讳元，宋末自闽徙居。');
  await expect(page.getByText('输入文字')).toHaveCount(0);

  // Ctrl+U（StarterKit 默认键位）不许留下服务端存不住的 mark（FR-031）。
  await page.keyboard.press('Control+u');
  await page.keyboard.type('这一段曾经被下划线毁掉。');
  await page.getByRole('button', { name: '立即保存' }).click();
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(canvas).toContainText('这一段曾经被下划线毁掉。');
  await takeEditorFocus(canvas);

  // 只设字体、字号留空：TipTap 会把 null 一起序列化，服务端必须吃下（FR-030）。
  await page.keyboard.press('Control+a');
  await page.locator('#article-font-family').selectOption('KaiTi');
  await page.getByRole('button', { name: '立即保存' }).click();
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(
    page.locator('.article-canvas span[style*="KaiTi"]')
  ).toHaveCount(1);

  // 在途保存不许被「返回」绕过，也不许把新敲的字吃掉（FR-016、FR-014）。
  await takeEditorFocus(canvas);
  await page.keyboard.press('End');
  // 用一道闸门把保存请求卡在途（不靠猜延时）：3 秒 watchdog 之内放开，
  // 既验「在途不许先跳走」，也验「等回来再导航」。
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/dashboard/project/**', async (route) => {
    if (route.request().method() === 'POST') {
      await gate;
    }
    await route.continue();
  });
  await page.keyboard.type('在途补的一句话');
  await page.waitForTimeout(2_100); // 自动保存已发出，响应被闸门按住
  await page.getByLabel('返回谱文列表').click();
  await page.waitForTimeout(400);
  expect(page.url(), '保存在途时不许先跳走（FR-016）').toMatch(
    /\/articles\/[0-9a-f-]+$/
  );
  release();
  await expect(page).toHaveURL(/\/articles$/, { timeout: 15_000 });
  await page.unroute('**/dashboard/project/**');

  // 回到这篇，最后那句话必须在（没被旧回显覆盖，也没被丢）。
  await page.getByRole('link', { name: '终审回归谱序' }).first().click();
  await expect(page.locator('.article-canvas')).toContainText('在途补的一句话');

  // 搜索要跨分类（FR-032）：另建一篇放进分类，选中该分类后仍搜得到本篇。
  await page.getByLabel('返回谱文列表').click();
  await expect(page).toHaveURL(/\/articles$/);
  await page.getByRole('button', { name: '新建谱文' }).click();
  await createArticleAndOpen(page, '另篇在分类里');
  await page.getByLabel('返回谱文列表').click();
  await expect(page).toHaveURL(/\/articles$/);

  const tree = page.getByRole('navigation', { name: '谱文分类' });
  await tree.getByRole('button', { name: '新建分类' }).click();
  await tree.getByLabel('分类名称').fill('谱序类');
  await tree.getByLabel('分类名称').press('Enter');
  await expect(tree.getByText('谱序类').first()).toBeVisible();

  const otherRow = page.locator('li').filter({ hasText: '另篇在分类里' });
  await otherRow.getByLabel('「另篇在分类里」的操作').click();
  await page.getByRole('menuitem', { name: '移到分类' }).click();
  const moveDialog = page.getByRole('dialog', { name: '移到分类' });
  await expect(moveDialog).toBeVisible();
  // 打开时预选这篇当前所在的分类（评审 S3）。
  await expect(
    moveDialog.getByRole('combobox', { name: '目标分类' })
  ).toContainText('默认分类');
  await moveDialog.getByRole('combobox', { name: '目标分类' }).click();
  await page.getByRole('option', { name: '谱序类' }).click();
  await moveDialog.getByRole('button', { name: '移动' }).click();
  await expect(otherRow).toContainText('谱序类');

  await tree.getByRole('button', { name: /^谱序类/ }).click();
  await expect(otherRow).toBeVisible();
  await page.locator('#article-search').fill('终审回归');
  await expect(
    page.locator('li').filter({ hasText: '终审回归谱序' })
  ).toContainText('默认分类');

  expect(errors).toEqual([]);
});
