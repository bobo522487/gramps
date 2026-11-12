import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  type ProjectView,
  ProjectWorkspace,
} from '@/components/project/project-workspace';

const project: ProjectView = {
  id: 'p1',
  name: '颍川陈氏',
  ref: 'chenref',
  themeName: '陈氏宗谱',
  surname: '陈',
  hallCode: null,
  countriesRegions: null,
  createdAt: '2026-11-01',
  createdAtIso: '2026-11-01T00:00:00.000Z',
};

describe('ProjectWorkspace directory', () => {
  it('renders the organization breadcrumb, search, and a compact card', () => {
    const html = renderToStaticMarkup(
      <ProjectWorkspace
        orgId="org-1"
        orgName="陈氏"
        projects={[project]}
        canManage
      />
    );

    expect(html).toContain('陈氏');
    expect(html).toContain('搜索云谱空间');
    expect(html).toContain('颍川陈氏');
    expect(html).toContain('陈氏宗谱');
    expect(html).toContain('href="/dashboard/project/chenref"');
    expect(html).toContain('新建空间');
  });

  it('keeps the empty directory when the organization has no projects', () => {
    const html = renderToStaticMarkup(
      <ProjectWorkspace orgId="org-1" orgName="陈氏" projects={[]} canManage />
    );

    expect(html).toContain('还没有云谱空间');
    expect(html).not.toContain('href="/dashboard/project/');
  });
});
