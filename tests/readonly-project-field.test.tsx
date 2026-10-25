import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReadonlyProjectField } from '@/components/lineage/readonly-project-field';

const base = {
  id: 'lineage-surname',
  label: '姓氏',
  value: '陈',
  href: '/dashboard/project/abc/settings',
  disabledReason: '只有所有者或管理员可以修改项目基本信息',
};

describe('ReadonlyProjectField', () => {
  it('shows the inherited value and the project-info badge', () => {
    const html = renderToStaticMarkup(
      <ReadonlyProjectField {...base} canEdit={false} />
    );

    expect(html).toContain('姓氏');
    expect(html).toContain('陈');
    expect(html).toContain('项目信息');
    expect(html).toContain('修改所属项目基本信息');
  });

  it('renders a disabled button with the reason when the user cannot write the project', () => {
    const html = renderToStaticMarkup(
      <ReadonlyProjectField {...base} canEdit={false} />
    );

    expect(html).toContain('disabled');
    expect(html).toContain(base.disabledReason);
    expect(html).not.toContain('href="/dashboard/project/abc/settings"');
  });

  it('links to the project settings page when the user can write the project', () => {
    const html = renderToStaticMarkup(
      <ReadonlyProjectField {...base} canEdit />
    );

    expect(html).toContain('href="/dashboard/project/abc/settings"');
  });

  it('falls back to a placeholder when the inherited value is missing', () => {
    const html = renderToStaticMarkup(
      <ReadonlyProjectField {...base} value="" canEdit={false} />
    );

    expect(html).toContain('未设置');
  });
});
