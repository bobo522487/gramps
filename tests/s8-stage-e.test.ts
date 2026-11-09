import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

/**
 * 阶段 E（T43–T49）文档跟改门禁。与前几批一样，只读文本做静态断言，
 * 不 import 待测模块：文档被改回旧语义时 CI 必须变红。
 *
 * T47 删差异清单 / T49 标 delivered 有硬闸门（T40 目标环境数字、folder
 * 扁平化独立批次、G0–G5 与切换日），本批不假交付，改为断言「挂起台账显式登记」。
 */
describe('S8 阶段 E：文档跟改与 ADR', () => {
  test('E-1 T43：架构文档按目标态重写，旧角色 / 插件 / 软删语义 0 命中', () => {
    const arch = read('docs/architecture.md');
    expect(arch).not.toContain('organization 插件');
    expect(arch).not.toContain('app_rw');
    expect(arch).not.toContain('FORCE RLS');
    expect(arch).not.toContain('activity_logs');
    expect(arch).not.toContain('isNull(deletedAt)');
    expect(arch).toContain('genealogy_app');
    expect(arch).toContain('auth_service');
  });

  test('E-2 T43：约束要有执行者补上目标态验收脚本', () => {
    expect(read('docs/architecture.md')).toContain('verify:target-schema');
  });

  test('E-3 T44：谱系契约按「位置引用 / 事实主体」重写', () => {
    const contracts = read('docs/contracts/README.md');
    expect(contracts).toContain('`node` 是纯位置引用');
    expect(contracts).toContain('`person` 是主体');
    expect(contracts).toContain('位置行');
    expect(contracts).not.toContain('入参必填 `requestId`');
    expect(contracts).not.toContain('部分唯一索引');
    expect(contracts).not.toContain('谱文未软删');
  });

  test('E-4 T44：幂等键失效被如实登记，不伪装成已兑现能力', () => {
    const contracts = read('docs/contracts/README.md');
    expect(contracts).toContain('不提供重放幂等');
  });

  test('E-5 T45：运维手册旧处置 SQL 0 命中，补 big-bang 恢复剧本', () => {
    const rb = read('docs/runbooks/README.md');
    expect(rb).not.toContain('deleted_at');
    expect(rb).not.toContain('drizzle.__drizzle_migrations');
    expect(rb).not.toContain('app_rw');
    expect(rb).not.toContain('has_org_role');
    expect(rb).toContain('恢复剧本');
    expect(rb).toContain('ON DELETE RESTRICT');
  });

  test('E-6 T46：产品意图与入口文件按无软删目标态跟改', () => {
    const vision = read('docs/vision.md');
    expect(vision).not.toContain('统计口径定义在 `docs/data-model.md`');
    expect(vision).not.toContain('删了找不回');
    expect(vision).not.toContain('软删兜底');
    const readme = read('README.md');
    expect(readme).toContain('RESTRICT');
    expect(readme).toContain('目标态');
  });

  test('E-7 T48：新增 ADR 且软删 / 树存储 / RLS 旧决策标 superseded', () => {
    const adr = read('docs/adr/README.md');
    expect(adr).toContain('`0020`');
    for (const id of ['0003', '0004', '0006', '0018']) {
      expect(adr, `${id} 未在取代关系表登记`).toMatch(
        new RegExp(`\\| \`${id}\`[^\\n]*superseded`)
      );
    }
    const files = readdirSync(join(root, 'docs/adr'));
    expect(
      files.some((name) => /^0020-.*\.md$/.test(name)),
      '新增 ADR 正文文件缺失'
    ).toBe(true);
  });

  test('E-8 收口台账：挂起项已换成收口记录，S8 为 delivered 且有实证', () => {
    const roadmap = read('docs/roadmap.md');
    // 阶段 E 收口后，原来的「挂起项」表已替换为逐项收口记录。
    expect(roadmap).not.toContain('阶段 E 挂起项');
    expect(roadmap).toContain('阶段 E 收口记录');
    expect(roadmap).toContain('T40');
    expect(roadmap).toContain('#14');
    // 首列精确匹配：S4 的「依赖」列也会出现 `S8`，substring 命中会取错行。
    const s8 =
      roadmap.split('\n').find((line) => /^\|\s*`S8`\s*\|/.test(line)) ?? '';
    expect(s8, 'S8 条目行缺失').not.toBe('');
    expect(s8).toContain('delivered');
    // delivered 不算嘴说：行内必须给出可复核的实证口径。
    expect(s8).toContain('verify:target-schema');
    expect(s8).not.toContain('in_progress');
  });

  test('E-9 配套文档旧语义清理，差异清单已随 T47 删除', () => {
    const gloss = read('docs/glossary.md');
    expect(gloss).not.toContain('待 T23 跟改');
    expect(gloss).toContain('RESTRICT');
    const nfr = read('docs/nfr.md');
    // 允许「旧表已整表退役」的诚实登记，只拦把它当现存能力描述的旧语义。
    expect(nfr).not.toContain('`activity_logs` 是产品活动流');
    expect(nfr).toContain('整表退役');
    expect(nfr).not.toContain('业务表是软删');
    // T47 之后 data-model 只剩目标态：差异清单整节删除，原 §9 重编号为 §8。
    const dm = read('docs/data-model.md');
    expect(dm).toContain('## 8. 约束要有执行者');
    expect(dm).not.toContain('## 8. 重构前的实现差异');
    expect(dm).not.toContain('阶段 E 挂起');
  });

  test('E-10 T49 可落地部分：变更记录与对照表补上重构范围', () => {
    expect(read('CHANGELOG.md')).toContain('S8');
    expect(read('CONTRIBUTING.md')).toContain('数据模型重构');
  });

  test('E-11 文档门禁的头部四项只约束文档集，ADR 正文不被误报', () => {
    const script = read('scripts/check-docs.mjs');
    expect(script).toContain('isSubdirReadme');
    expect(script).toMatch(/if \(!isRootDoc && !isSubdirReadme\) continue;/);
    expect(script).toContain('ADR 正文');
  });

  test('E-12 #14 已落地：差异清单整节删除，旧口径不许回潮', () => {
    const dm = read('docs/data-model.md');
    // T47：14 条差异全部消掉后整节删除，data-model 只留目标态。
    expect(dm).not.toContain('## 8. 重构前的实现差异');
    expect(dm).not.toContain('现状（待改）');
    expect(dm).not.toContain('#14');
    // 原 §9 重编号为 §8，执行者表仍在（引用不许断链）。
    expect(dm).toContain('## 8. 约束要有执行者');

    // 阶段 E 两批把 #14 先后误写成「从未拍板」「决策已定但未开工」，
    // 并扩散到台账 / ADR / 架构 / CHANGELOG / 基线注释。以下文字一律不许回潮。
    const stale = [
      /从未拍板/,
      /去留未拍板/,
      /层级去留待产品 \+ 技术负责人拍板/,
      /#14 拍板(并迁出|迁出前)/,
      /必须在 B3 开工前拍板/,
      /待拍板的规格差异/,
      /层级去留已升级为独立规格问题/,
      /决策已定、实现未开工/,
      /#14 独立批次影响面/,
      /超集建表以免运行期 42703/,
    ];
    for (const file of [
      'docs/data-model.md',
      'docs/roadmap.md',
      'docs/architecture.md',
      'docs/adr/README.md',
      'docs/adr/0020-目标数据模型整体重建.md',
      'CHANGELOG.md',
      'lib/db/migrations/0000_target_schema.sql',
    ]) {
      const text = read(file);
      for (const pattern of stale) {
        expect(text, `${file} 仍有 #14 错误口径 ${pattern}`).not.toMatch(
          pattern
        );
      }
    }

    const roadmap = read('docs/roadmap.md');
    // 交付记录要留痕，且 T47 不再挂在待办里。
    expect(roadmap).toContain('`#14` 独立批次（2026-11-09 已交付）');
    expect(roadmap).not.toContain('## 删差异清单');
    // ADR 待办表不再把「层级去留拍板」或 #14 列为待办。
    const adrIndex = read('docs/adr/README.md');
    expect(adrIndex).not.toContain('`folder` 层级去留拍板');
    expect(adrIndex).not.toContain('| `#14` folder 扁平化独立批次 |');
  });
});
