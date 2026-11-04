import { describe, expect, it } from 'vitest';

import { sanitizePasteHtml } from '@/components/article/editor/paste-filter';

/**
 * 粘贴清洗（FR-013 / FR-012 / 003，tasks T008）。
 *
 * 002 时几乎全剥：加粗斜体、列表都被降级成纯段落。003 起白名单**有限放行**：
 * 加粗/斜体/下划线、单层项目符号/编号列表、段落左中右对齐、两级标题；
 * 颜色/行距/表格/引用/链接/外链图片仍丢，嵌套列表压平成单层，文字一个不丢。
 * 这里只测纯字符串变换；ProseMirror schema 与 doc.ts 落库前再各兜一层。
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

  it('丢掉外链图片，不保留任何外链痕迹', () => {
    const html =
      '<p>像赞</p><img src="https://evil.example/a.png" alt="祖像" />';
    const out = sanitizePasteHtml(html);
    expect(out).toBe('<p>像赞</p>');
    expect(out).not.toContain('evil.example');
  });

  it('放行加粗/斜体/下划线，统一成规范标签并剥掉属性', () => {
    expect(
      sanitizePasteHtml(
        '<p><b class="x">粗</b><strong>重</strong><i>斜</i><em>强调</em><u style="color:red">下</u></p>'
      )
    ).toBe(
      '<p><strong>粗</strong><strong>重</strong><em>斜</em><em>强调</em><u>下</u></p>'
    );
  });

  it('仍丢删除线/代码/链接/颜色/字体等未开放能力，只留文字', () => {
    expect(
      sanitizePasteHtml(
        '<p><s>删</s><code>代号</code><a href="https://x">族谱网</a><span style="color:red">红</span><font color="red">字</font><sup>注</sup></p>'
      )
    ).toBe('<p>删代号族谱网红字注</p>');
  });

  it('保留单层项目符号列表', () => {
    expect(sanitizePasteHtml('<ul><li>凡例一</li><li>凡例二</li></ul>')).toBe(
      '<ul><li>凡例一</li><li>凡例二</li></ul>'
    );
  });

  it('保留单层编号列表，去掉 ol/li 上的属性', () => {
    expect(
      sanitizePasteHtml('<ol start="3"><li class="y">甲</li><li>乙</li></ol>')
    ).toBe('<ol><li>甲</li><li>乙</li></ol>');
  });

  it('嵌套列表压平成单层，三层文字都不丢（FR-031 / FR-008）', () => {
    expect(
      sanitizePasteHtml(
        '<ul><li>甲<ul><li>乙<ul><li>丙</li></ul></li></ul></li><li>丁</li></ul>'
      )
    ).toBe('<ul><li>甲</li><li>乙</li><li>丙</li><li>丁</li></ul>');
  });

  it('嵌套 ol 混在 ul 里照样压到外层列表，不保留多级缩进', () => {
    const out = sanitizePasteHtml('<ul><li>甲<ol><li>乙</li></ol>丙</li></ul>');
    expect(out).toBe('<ul><li>甲</li><li>乙</li><li>丙</li></ul>');
    expect(out.match(/<ul>/g)).toHaveLength(1);
    expect(out).not.toContain('<ol>');
  });

  it('保留段落左/中/右对齐，丢掉颜色/行距等其它内联样式', () => {
    expect(
      sanitizePasteHtml(
        '<p style="color:red;text-align:center;line-height:2">居中</p>'
      )
    ).toBe('<p style="text-align: center">居中</p>');
    expect(sanitizePasteHtml('<p align="right">靠右</p>')).toBe(
      '<p style="text-align: right">靠右</p>'
    );
    expect(sanitizePasteHtml('<p style="text-align:left">靠左</p>')).toBe(
      '<p style="text-align: left">靠左</p>'
    );
  });

  it('两端对齐 justify 不在 FR-009 开放范围，样式被丢掉', () => {
    expect(sanitizePasteHtml('<p style="text-align:justify">两端</p>')).toBe(
      '<p>两端</p>'
    );
  });

  it('标题对齐保留（对齐作用在块级 textAlign）', () => {
    expect(sanitizePasteHtml('<h2 align="center">凡例</h2>')).toBe(
      '<h2 style="text-align: center">凡例</h2>'
    );
  });

  it('表格结构丢弃，单元格文字保留', () => {
    const out = sanitizePasteHtml(
      '<table><tbody><tr><td>一世</td><td>二世</td></tr></tbody></table>'
    );
    expect(out).toContain('一世');
    expect(out).toContain('二世');
    expect(out).not.toMatch(/table|td|tr/);
  });

  it('引用块降级成段落，链接只留文字', () => {
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

  it('纯文本粘贴提成段落', () => {
    expect(sanitizePasteHtml('一段纯文字')).toBe('<p>一段纯文字</p>');
  });

  it('组合：标题 + 加粗 + 单层列表 + 居中，白名单一次全放行', () => {
    // 输入用规范写法（text-align 后带空格），与实现的规范化输出一致，验证组合不丢格式。
    const html =
      '<h1>谱序</h1><p><strong>始祖</strong>讳某</p><ul><li>甲</li><li>乙</li></ul><p style="text-align: center">居中落款</p>';
    expect(sanitizePasteHtml(html)).toBe(html);
  });
});
