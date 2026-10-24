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
  const lineageDialog = page.getByRole('dialog', { name: '新建谱系' });
  await expect(lineageDialog).toBeVisible();
  await page.locator('#lineage-name').fill('E2E 谱系');
  await page.locator('#lineage-surname').fill('陈');
  await lineageDialog.getByRole('button', { name: '创建谱系' }).click();
  await expect(page).toHaveURL(/\/lineages\/[^/]+$/);

  await page.getByRole('button', { name: '录入始祖' }).click();
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

  const rootNode = personNodes.filter({ hasText: '太公' });
  await rootNode.hover();
  await rootNode.getByRole('button', { name: '添子女', exact: true }).click();
  const childDialog = page.getByRole('dialog', { name: '添加子女' });
  await expect(childDialog).toBeVisible();
  await page.locator('#create-node-name').fill('二世');
  await childDialog.getByRole('button', { name: '添加子女' }).click();
  await expect(personNodes).toHaveCount(2);
  await expect(generationHeaders.filter({ hasText: '2世' })).toBeVisible();

  const childNode = personNodes.filter({ hasText: '二世' });
  await childNode.click();
  await expect(page.locator('#inspector-courtesy')).toBeVisible();
  await page.locator('#inspector-courtesy').fill('伯');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByText('已保存')).toBeVisible();

  await page.reload();
  await expect(personNodes).toHaveCount(2);
  await personNodes.filter({ hasText: '二世' }).click();
  await expect(page.locator('#inspector-courtesy')).toHaveValue('伯');

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
  expect(inviteLink).toContain('/sign-up?invite=');

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
    await expect(inviteePage).toHaveURL(/\/dashboard\/join\?invite=/);
    await expect(inviteePage.getByText(inviteeEmail)).toBeVisible();

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
