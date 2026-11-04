import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Phase-1 lineage workspace UX contracts: viewer read-only inspector,
 * dirty discard / delete ConfirmDialogs, unified personQuery, no window.confirm.
 */

describe('lineage workspace UX contracts', () => {
  it('marks the inspector read-only for viewers and hides the save button', () => {
    const src = readFileSync('components/lineage/person-inspector.tsx', 'utf8');
    expect(src).toMatch(/const readOnly = !canWrite/);
    expect(src).toMatch(/仅查看/);
    expect(src).toMatch(/readOnly=\{readOnly\}/);
    expect(src).toMatch(/\{canWrite \? \([\s\S]*保存档案/);
    expect(src).toMatch(/onDirtyChange/);
  });

  it('guards dirty close/switch and delete with ConfirmDialog in the detail shell', () => {
    const src = readFileSync('components/lineage/lineage-detail.tsx', 'utf8');
    expect(src).toMatch(/ConfirmDialog/);
    expect(src).toMatch(/放弃未保存的修改/);
    expect(src).toMatch(/确认删除人丁/);
    expect(src).not.toMatch(/window\.confirm/);
    expect(src).toMatch(/personQuery/);
    expect(src).not.toMatch(/tableQuery|canvasQuery/);
  });

  it('replaces sidebar delete confirms and keeps one primary create CTA', () => {
    const sidebar = readFileSync(
      'components/lineage/lineage-sidebar.tsx',
      'utf8'
    );
    const dialogs = readFileSync(
      'components/lineage/sidebar-delete-dialogs.tsx',
      'utf8'
    );
    expect(sidebar).toMatch(/SidebarDeleteDialogs/);
    expect(sidebar).not.toMatch(/window\.confirm/);
    expect(dialogs).toMatch(/确认删除谱系/);
    expect(dialogs).toMatch(/确认删除文件夹/);
    // Header icon + soft button CTA; no third Plus in the 谱系卷册 heading.
    expect(sidebar).toMatch(/新建谱系/);
    expect(sidebar).not.toMatch(
      /谱系卷册[\s\S]*aria-label="新建谱系"[\s\S]*搜索谱系或文件夹/
    );
  });

  it('exposes canvas search aria-label and cycles matches via personQuery', () => {
    const canvas = readFileSync(
      'components/lineage/canvas/genealogy-canvas.tsx',
      'utf8'
    );
    const toolbar = readFileSync(
      'components/lineage/canvas/canvas-toolbar.tsx',
      'utf8'
    );
    expect(toolbar).toMatch(/aria-label="搜索族人定位"/);
    expect(toolbar).toMatch(/更多画布工具/);
    expect(canvas).toMatch(/personQuery/);
    expect(canvas).toMatch(/matchCursorRef/);
    expect(canvas).toMatch(/再按 Enter 下一个/);
    expect(canvas).not.toMatch(/canvasQuery/);
  });
});
