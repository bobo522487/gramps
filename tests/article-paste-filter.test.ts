import { describe, expect, it } from 'vitest';

import { sanitizePasteHtml } from '@/components/article/editor/paste-filter';

/**
 * 粘贴清洗（FR-013、FR-031、US3-AC6）。
 *
 * 谱文只收段落与两级标题：外部内容带进来的三级以上标题、加粗斜体、表格、
 * 列表、外链图片都必须被剥掉，但**文字本身一个字都不能丢**。
 * 这里只测纯字符串变换；ProseMirror 的 schema 过滤在编辑器里再兜一层。
 */

describe('sanitizePasteHtml', () => {
  it('保留段落与两级标题', () => {
    const html = '<h1>谱序</h1><p>正文一段。</p><h2>小标题</h2>';
    expect(sanitizePasteHtml(html)).toBe(
      '<h1>谱序</h1><p>正文一段。</p><h2>小标题</h2>'
    );
  });

  it('三级以上标题降级成段落，文字不丢', () => {
    expect(sanitizePasteHtml('<h3>昭穆</h3><h6>末等</h6>')).toBe(
      '<p>昭穆</p><p>末等</p>'
    );
  });

  it('丢掉图片，不保留任何外链痕迹', () => {
    const html =
      '<p>像赞</p><img src="https://evil.example/a.png" alt="祖像" />';
    const out = sanitizePasteHtml(html);
    expect(out).toBe('<p>像赞</p>');
    expect(out).not.toContain('evil.example');
  });

  it('剥掉加粗斜体等标记，只留文字', () => {
    expect(sanitizePasteHtml('<p><b>粗</b><em>斜</em><s>删</s></p>')).toBe(
      '<p>粗斜删</p>'
    );
    expect(sanitizePasteHtml('<p><code>代号</code></p>')).toBe('<p>代号</p>');
  });

  it('表格拆成段落，单元格文字保留', () => {
    const out = sanitizePasteHtml(
      '<table><tbody><tr><td>一世</td><td>二世</td></tr></tbody></table>'
    );
    expect(out).toContain('一世');
    expect(out).toContain('二世');
    expect(out).not.toMatch(/table|td|tr/);
  });

  it('列表每项变成独立段落', () => {
    expect(sanitizePasteHtml('<ul><li>凡例一</li><li>凡例二</li></ul>')).toBe(
      '<p>凡例一</p><p>凡例二</p>'
    );
  });

  it('引用块与链接：块变成段落，链接只留文字', () => {
    expect(
      sanitizePasteHtml(
        '<blockquote>先人语</blockquote><p><a href="https://x">族谱网</a></p>'
      )
    ).toBe('<p>先人语</p><p>族谱网</p>');
  });

  it('换行与空段落清掉，不留空白块', () => {
    expect(sanitizePasteHtml('<p>甲<br/>乙</p><p> </p><p></p>')).toBe(
      '<p>甲乙</p>'
    );
  });

  it('非谱文结构（div/span）里的文字提出来成段落', () => {
    expect(sanitizePasteHtml('<div><span>迁入时间</span></div>')).toBe(
      '<p>迁入时间</p>'
    );
  });
});
