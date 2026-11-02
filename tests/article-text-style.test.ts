import { describe, expect, it } from 'vitest';

import {
  articleFontFamily,
  articleFontSize,
  articleTextStyle,
} from '@/components/article/editor/text-style';

// 测试只从 components/article/editor/text-style 取扩展：`@tiptap/*` 被 biome
// noRestrictedImports 限在 lib/article/** 与 components/article/editor/**（ADR 0010
// 「依赖必须有消费者」），给测试开口子就等于开了第二条路。

/**
 * US4 字体与字号（FR-030、T042）。
 *
 * 裸的 `TextStyle` 只是一个「能挂 inline style 的壳」，不认识 `fontFamily` /
 * `fontSize`：`setMark('textStyle', { fontFamily })` 传进去的 attrs 会被
 * ProseMirror 丢掉，既不落库也不渲染。这两个属性由 `FontFamily` / `FontSize`
 * 挂到 `textStyle` 上，输出 inline style —— 复制带格式（US4-AC2）靠的就是这份
 * style 输出；「无楷体环境显示替代字体」（US4-AC3）也成立，因为我们只写字体名、
 * 不写字体文件，浏览器按 CSS 规则自行替代。
 */

type AttributeConfig = {
  default?: unknown;
  renderHTML?: (attributes: Record<string, unknown>) => Record<string, unknown>;
};

function globalAttributesOf(extension: {
  config: { name?: string; addGlobalAttributes?: unknown };
}): Record<string, AttributeConfig> {
  const addGlobalAttributes = extension.config.addGlobalAttributes;
  if (typeof addGlobalAttributes !== 'function') {
    throw new Error(`${extension.config.name} 没有声明 addGlobalAttributes`);
  }
  const rules = (
    addGlobalAttributes as () => {
      types: string[];
      attributes: Record<string, AttributeConfig>;
    }[]
  ).call({ name: extension.config.name, options: { types: ['textStyle'] } });
  const target = rules.find((rule) => rule.types.includes('textStyle'));
  if (!target) {
    throw new Error(`${extension.config.name} 没有把属性挂到 textStyle 上`);
  }
  return target.attributes;
}

describe('字体与字号属性（FR-030）', () => {
  it('三项扩展的名字就是 textStyle / fontFamily / fontSize', () => {
    expect([
      articleTextStyle.config.name,
      articleFontFamily.config.name,
      articleFontSize.config.name,
    ]).toEqual(['textStyle', 'fontFamily', 'fontSize']);
  });

  const fontFamily = globalAttributesOf(articleFontFamily).fontFamily;
  const fontSize = globalAttributesOf(articleFontSize).fontSize;

  it('两个属性默认都是未设置', () => {
    expect(fontFamily?.default).toBeNull();
    expect(fontSize?.default).toBeNull();
  });

  it('输出 inline style，供复制带格式与浏览器渲染使用', () => {
    expect(fontFamily?.renderHTML?.({ fontFamily: 'KaiTi' })).toEqual({
      style: 'font-family: KaiTi',
    });
    expect(fontSize?.renderHTML?.({ fontSize: '19px' })).toEqual({
      style: 'font-size: 19px',
    });
  });

  it('没设置时不产出空 style（否则每段文字都会套一个空 span）', () => {
    expect(fontFamily?.renderHTML?.({ fontFamily: null })).toEqual({});
    expect(fontSize?.renderHTML?.({ fontSize: null })).toEqual({});
  });

  it('字体与字号各自产出一条 CSS 声明，可以同时挂在一个 span 上', () => {
    const familyStyle = fontFamily?.renderHTML?.({ fontFamily: 'SimSun' });
    const sizeStyle = fontSize?.renderHTML?.({ fontSize: '14px' });
    const parts = [familyStyle?.style, sizeStyle?.style].filter(Boolean);
    expect(parts).toEqual(['font-family: SimSun', 'font-size: 14px']);
  });

  it('只挂一个 textStyle 标记，不新增别的标记（FR-031）', () => {
    expect(articleTextStyle.config.name).toBe('textStyle');
  });
});
