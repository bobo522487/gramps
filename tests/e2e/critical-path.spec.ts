import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('critical path: sign up, create project, record founder, add child, edit inspector', async ({
  page,
}) => {
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

  const email = `e2e+${Date.now()}@example.com`;
  const password = 'Passw0rd!e2e';

  await page.goto('/sign-up');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  // sign_up creates a personal organization, so /dashboard redirects into it.
  await expect(page).toHaveURL(/\/dashboard\/org\/[^/]+$/);

  await page.getByRole('button', { name: '新建空间' }).click();
  const projectDialog = page.getByRole('dialog', { name: '创建云谱项目' });
  await expect(projectDialog).toBeVisible();

  const submitProject = projectDialog.getByRole('button', { name: '确定' });
  await expect(submitProject).toBeDisabled();

  await page.locator('#project-name').fill('取消后不应保留');
  await projectDialog.getByRole('button', { name: '取消' }).click();
  await expect(projectDialog).toBeHidden();
  await page.getByRole('button', { name: '新建空间' }).click();
  await expect(projectDialog).toBeVisible();
  await expect(page.locator('#project-name')).toHaveValue('');
  await expect(submitProject).toBeDisabled();

  await page.locator('#project-name').fill('E2E 云谱');
  await page.locator('#project-surname').fill('陈');
  await page.locator('#project-regions').fill('中国福建');
  await page.locator('#project-theme-name').fill('E2E 陈氏宗谱');

  await expect(page.locator('#project-status')).toContainText('进行中');
  await expect(
    projectDialog.getByRole('button', { name: '1 星' })
  ).toHaveAttribute('aria-pressed', 'true');
  await projectDialog.getByRole('button', { name: '3 星' }).click();
  for (const star of ['1 星', '2 星', '3 星']) {
    await expect(
      projectDialog.getByRole('button', { name: star })
    ).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(
    projectDialog.getByRole('button', { name: '4 星' })
  ).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#project-notes').fill('E2E 备注');
  await expect(submitProject).toBeEnabled();
  await submitProject.click();
  await expect(page).toHaveURL(/\/dashboard\/project\/[^/]+$/);

  const projectRef =
    new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) ?? '';
  expect(projectRef).not.toBe('');

  await expect(page.getByText('进行中', { exact: true })).toBeVisible();
  await expect(page.getByText('3 / 5', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E 备注', { exact: true })).toBeVisible();

  await page.goto(`/dashboard/project/${projectRef}/settings`);
  await expect(page.locator('input#project-surname')).toHaveCount(0);
  await expect(page.locator('input#project-theme-name')).toHaveCount(0);
  await expect(page.locator('#project-surname')).toHaveText('陈');
  await expect(page.locator('#project-theme-name')).toHaveText('E2E 陈氏宗谱');
  await expect(page.locator('#project-name')).toHaveValue('E2E 云谱');
  await expect(page.locator('#project-notes')).toHaveValue('E2E 备注');
  await expect(page.locator('#project-status')).toContainText('进行中');
  await expect(page.getByRole('button', { name: '3 星' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await page.goto(`/dashboard/project/${projectRef}/lineages`);
  await expect(
    page.getByRole('complementary').getByText('谱系管理', { exact: true })
  ).toBeVisible();

  await page.getByRole('button', { name: '新建文件夹' }).first().click();
  const renameInput = page.getByLabel('重命名');
  await expect(renameInput).toBeVisible();
  await renameInput.fill('E2E 卷册');
  await renameInput.press('Enter');
  const folderRow = page.getByRole('button', { name: /E2E 卷册/ });
  await expect(folderRow).toBeVisible();

  await folderRow.hover();
  await page.getByRole('button', { name: '在此文件夹下新建谱系' }).click();
  const lineageDialog = page.getByRole('dialog', { name: '创建谱系' });
  await expect(lineageDialog).toBeVisible();

  // 姓氏继承项目，弹窗里不再有可编辑输入框。
  await expect(page.locator('input#lineage-surname')).toHaveCount(0);
  await expect(page.locator('#lineage-surname')).toHaveText('陈');

  const submitLineage = lineageDialog.getByRole('button', { name: '确定' });
  await expect(submitLineage).toBeDisabled();

  await page.locator('#lineage-name').fill('E2E 谱系');
  await expect(submitLineage).toBeEnabled();

  await submitLineage.click();
  await expect(page).toHaveURL(/\/lineages\/[^/]+$/);

  // 新建的空谱系会自动弹出「录入始祖」。
  const rootDialog = page.getByRole('dialog', { name: '录入始祖' });
  await expect(rootDialog).toBeVisible();
  await page.locator('#create-node-name').fill('太公');
  await rootDialog.getByRole('button', { name: '录入始祖' }).click();

  const personNodes = page.locator('.react-flow__node-bookPerson');
  const generationHeaders = page.locator('.react-flow__node-generationHeader');
  await expect(personNodes).toHaveCount(1);
  await expect(generationHeaders.filter({ hasText: '1世' })).toBeVisible();
  await expect(
    page.locator('header').getByText(/共\s*1\s*位族人/)
  ).toBeVisible();

  // 录入框只填了名、姓留空。名整段写入 person_name，卡片与「当前选中」都显示这段名。
  const rootNode = personNodes.filter({ hasText: '公' });
  const actionBar = page.getByTestId('node-action-bar');
  // 卡片上不再有悬浮操作按钮：选中人丁后从底部快捷条发起。
  await rootNode.click();
  await expect(page.getByText(/当前选中：太公/)).toBeVisible();
  await expect(rootNode.getByRole('button', { name: '添子女' })).toHaveCount(0);
  await actionBar.getByRole('button', { name: '加子女' }).click();
  const childDialog = page.getByRole('dialog', { name: '添加子女' });
  await expect(childDialog).toBeVisible();
  await page.locator('#create-node-name').fill('二世');
  await childDialog.getByRole('button', { name: '添加子女' }).click();
  await expect(personNodes).toHaveCount(2);
  await expect(generationHeaders.filter({ hasText: '2世' })).toBeVisible();

  const childNode = personNodes.filter({ hasText: '世' });
  await childNode.click();
  await expect(page.locator('#inspector-courtesy')).toBeVisible();
  await page.locator('#inspector-courtesy').fill('伯');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByText('已保存')).toBeVisible();

  // 选中人丁后底部出现快捷条，卡片上不再有操作菜单。
  await expect(actionBar).toBeVisible();
  await expect(actionBar).toContainText('当前选中');
  await expect(actionBar.getByRole('button', { name: '加子女' })).toBeVisible();

  // 抽屉覆盖右侧工具区，先关掉再切视图。
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector-courtesy')).toBeHidden();

  // 表格视图也不再有人丁操作入口（旧的「⋯」菜单只存在于这里的「操作」列）。
  await page
    .getByRole('button', { name: '世系表', exact: true })
    .first()
    .click();
  await expect(page.getByRole('columnheader', { name: '操作' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '人丁操作' })).toHaveCount(0);
  await page
    .getByRole('button', { name: '谱系图', exact: true })
    .first()
    .click();

  // 右键人丁拿到同一组命令。
  await childNode.click({ button: 'right' });
  const contextMenu = page.getByRole('menu');
  await expect(contextMenu).toBeVisible();
  await expect(
    contextMenu.getByRole('menuitem', { name: '加子女' })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(contextMenu).toBeHidden();

  // 始祖只能加子女与配偶：快捷条里没有删除。
  await rootNode.click();
  await expect(actionBar).not.toContainText('删除');

  await page.reload();
  await expect(personNodes).toHaveCount(2);
  // 刷新后没有选中人丁：右侧不留空占位。
  await expect(page.getByText('未选择族人')).toHaveCount(0);
  // 字/号现在落在 person_name（kind=courtesy），刷新后仍能读回。
  await personNodes.filter({ hasText: '世' }).click();
  await expect(page.getByText(/当前选中：二世/)).toBeVisible();
  await expect(page.locator('#inspector-courtesy')).toHaveValue('伯');
  // 换人丁时抽屉整体换内容，不串上一个人的字段值。
  await personNodes.filter({ hasText: '公' }).click();
  await expect(page.getByText(/当前选中：太公/)).toBeVisible();
  await expect(page.locator('#inspector-courtesy')).toHaveValue('');
  await personNodes.filter({ hasText: '世' }).click();
  await expect(page.getByText(/当前选中：二世/)).toBeVisible();
  await expect(page.locator('#inspector-courtesy')).toHaveValue('伯');
  // 抽屉可用 Esc 关闭，关闭后不留残影。
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector-courtesy')).toBeHidden();

  const search = page.getByLabel('搜索谱系或文件夹');
  await search.fill('E2E 谱系');
  const lineageRow = page.getByRole('button', { name: /E2E 谱系/ });
  await expect(lineageRow).toBeVisible();
  await search.clear();
  await expect(lineageRow).toBeVisible();

  await folderRow.click();
  await expect(lineageRow).toBeHidden();
  await folderRow.click();
  await expect(lineageRow).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('auth journey: invite, sign out, sign in, accept invitation', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const stamp = Date.now();
  const password = 'Passw0rd!e2e';
  const ownerEmail = `e2e-owner+${stamp}@example.com`;
  const inviteeEmail = `e2e-invitee+${stamp}@example.com`;

  await page.goto('/sign-up');
  await page.locator('#email').fill(ownerEmail);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/org\/[^/]+$/);

  const ownerSlug = new URL(page.url()).pathname
    .split('/')
    .filter(Boolean)
    .at(-1);
  expect(ownerSlug).toBeTruthy();

  await page.goto(`/dashboard/org/${ownerSlug}/team`);
  await page.locator('#invite-email').fill(inviteeEmail);
  await page.getByRole('button', { name: '生成邀请链接' }).click();
  const inviteField = page.locator('#invite-url');
  await expect(inviteField).toBeVisible();
  const inviteLink = await inviteField.inputValue();
  // B2b 自建 token 之后邀请链接走 /join?token=，由落地页转交注册表单。
  expect(inviteLink).toContain('/join?token=');

  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/sign-in');
  await page.locator('#email').fill(ownerEmail);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/org/${ownerSlug}$`));

  const inviteeContext = await browser.newContext({
    baseURL: new URL(inviteLink).origin,
  });
  const inviteePage = await inviteeContext.newPage();
  try {
    await inviteePage.goto(inviteLink);
    await inviteePage.locator('#email').fill(inviteeEmail);
    await inviteePage.locator('#password').fill(password);
    await inviteePage
      .getByRole('button', { name: '注册', exact: true })
      .click();
    await expect(inviteePage).toHaveURL(/\/dashboard\/join\?token=/);
    // B2b 隐私约束：邀请预览只回组织名与角色，不回显受邀邮箱。
    await expect(inviteePage.getByText('接受组织邀请')).toBeVisible();
    await expect(
      inviteePage.getByRole('button', { name: '接受邀请' })
    ).toBeVisible();

    await inviteePage.getByRole('button', { name: '接受邀请' }).click();
    await expect(inviteePage).toHaveURL(/\/dashboard\/org\/[^/]+$/);

    const teamResponse = await inviteePage.goto(
      `/dashboard/org/${ownerSlug}/team`
    );
    expect(teamResponse?.status()).toBe(200);
    await expect(inviteePage.getByText(inviteeEmail)).toBeVisible();
  } finally {
    await inviteeContext.close();
  }

  expect(errors, errors.join('\n')).toEqual([]);
});
