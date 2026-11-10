import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR 0009 §2：drizzle-orm / drizzle-kit 只通过专门 PR 升级，不跟着 `pnpm update` 漂。
// 本文件是该决策的执行者：读 node_modules 里实际安装的版本，次版本/大版本漂移判红、补丁放行。
// package.json 的 specifier 形态由 pnpm-lock.yaml 与 CI 的 --frozen-lockfile 兜底，不在这里锁字面。

const root = process.cwd();

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

// 事实源是 node_modules 里真实安装的 manifest，不是 package.json 的 specifier：
// `pnpm update` 会把 specifier 与 node_modules 一起漂，只抄 specifier 抓不到漂移。
const installedOrm = readJson('node_modules/drizzle-orm/package.json') as {
  version: string;
};
const installedKit = readJson('node_modules/drizzle-kit/package.json') as {
  version: string;
};

/** `0.45.9` → `0.45`；用于把补丁放行、把次版本/大版本判红。 */
const minor = (version: string) => version.split('.').slice(0, 2).join('.');

const PINNED_ORM_MINOR = '0.45';
const PINNED_KIT_MINOR = '0.31';

/** 把「安装版本 → 是否守住钉版」抽成纯函数，供下面的说明性用例使用。 */
const keepsPin = (version: string) => minor(version) === PINNED_ORM_MINOR;

describe('ADR 0009 §2 ORM 版本钉死', () => {
  it('钉的是实际安装版本，补丁可进、次版本与大版本不可漂', () => {
    expect(minor(installedOrm.version)).toBe(PINNED_ORM_MINOR);
  });

  // 与 drizzle-orm 同理：kit 的钉版也要读实际安装版本，否则 `pnpm update drizzle-kit`
  // 把 node_modules 漂到 0.32 时，specifier 断言（^0.31.）会红但缺了「安装版本」这条腿。
  it('drizzle-kit 的安装版本同样钉在 0.31', () => {
    expect(minor(installedKit.version)).toBe(PINNED_KIT_MINOR);
  });

  // 说明性用例，不是独立证据：keepsPin 用的就是「钉的是实际安装版本」那条断言的同一个
  // 常量，这几行永远跟着 PINNED_ORM_MINOR 一起改，独立证伪不了任何东西。
  // 真正的证明是变异测试，可自行复现（不依赖任何外部记录）：
  // 把 node_modules/drizzle-orm/package.json 的 version 改成 0.46.0 →
  // 「钉的是实际安装版本」红，报 `expected '0.46' to be '0.45'`。改回即绿。
  it.each([
    ['0.45.4', true, '当前安装的补丁版本'],
    ['0.45.9', true, '补丁应放行'],
    ['0.46.0', false, '次版本漂移必须红'],
    ['1.0.0', false, '1.0 断崖重写必须红'],
  ])('安装版本 %s → keepsPin=%s（%s）', (version, expected) => {
    expect(keepsPin(version)).toBe(expected);
  });
});
