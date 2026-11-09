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

  test('E-8 挂起台账：T40 / #14 / T47 / T49 显式登记，S8 不写假 delivered', () => {
    const roadmap = read('docs/roadmap.md');
    expect(roadmap).toContain('阶段 E 挂起项');
    expect(roadmap).toContain('T40');
    expect(roadmap).toContain('#14');
    const s8 =
      roadmap.split('\n').find((line) => line.includes('| `S8` |')) ?? '';
    expect(s8, 'S8 条目行缺失').not.toBe('');
    expect(s8).toContain('in_progress');
    expect(s8).not.toContain('delivered');
  });

  test('E-9 配套文档旧语义清理，差异清单在挂起期保留且如实标注', () => {
    const gloss = read('docs/glossary.md');
    expect(gloss).not.toContain('待 T23 跟改');
    expect(gloss).toContain('RESTRICT');
    const nfr = read('docs/nfr.md');
    // 允许「旧表已整表退役」的诚实登记，只拦把它当现存能力描述的旧语义。
    expect(nfr).not.toContain('`activity_logs` 是产品活动流');
    expect(nfr).toContain('整表退役');
    expect(nfr).not.toContain('业务表是软删');
    const dm = read('docs/data-model.md');
    expect(dm).toContain('## 8.');
    expect(dm).toContain('阶段 E 挂起');
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

  test('E-12 #14 口径复核：决策已定按附录 A.2 扁平化，不是「待拍板」', () => {
    const dm = read('docs/data-model.md');
    // 方向依据是目标态规格里的书面决议 + 附录 A.2 的目标 DDL，不是待开拍板会。
    // 钉住 §8 的书面决议原文，不用裸子串——顶部说明也会复述这句话，
    // 只断言裸子串时把决议块删掉仍能蒙混过关。
    expect(dm).toContain('> **#14 已拍板：按附录 A 扁平化。**');
    expect(dm).toContain('拆分落在独立批次');

    // 阶段 E 第一批把「决策已定、实现未开工」误写成「从未拍板」，并扩散到
    // 台账 / ADR / 架构 / CHANGELOG / 基线注释。以下旧文字一律不许回潮。
    const stale = [
      /从未拍板/,
      /去留未拍板/,
      /层级去留待产品 \+ 技术负责人拍板/,
      /#14 拍板(并迁出|迁出前)/,
      /必须在 B3 开工前拍板/,
      /待拍板的规格差异/,
      /层级去留已升级为独立规格问题/,
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
    expect(roadmap).toContain('决策已定、实现未开工');
    expect(roadmap).toContain('#14 独立批次影响面');
    // ADR 待办表不再把「层级去留拍板」列为待办。
    expect(read('docs/adr/README.md')).not.toContain('`folder` 层级去留拍板');
  });
});
