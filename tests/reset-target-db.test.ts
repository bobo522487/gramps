import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/**
 * `scripts/reset-target-db.mjs` 是「G0① 整体重建」在执行侧的前置：唯一基线
 * `0000_target_schema.sql` 对 `auth.*` 用 `CREATE TABLE IF NOT EXISTS`，
 * 遇到旧库会整表跳过，drizzle 仍报 applied successfully（2026-11-09 生产
 * 迁移 job 的真实故障）。所以必须先把库清空。本组断言守住三件事：
 * 危险操作有闸、清空范围正确、public schema 不丢。
 */
describe('R1–R4 生产库重建前置脚本', () => {
  const script = read('scripts/reset-target-db.mjs');

  test('R1 默认 dry-run，必须 --apply 且 --confirm 与库名逐字相等', () => {
    expect(script).toContain("args.includes('--apply')");
    expect(script).toContain('--confirm=');
    // dry-run 分支必须在动库之前返回。
    expect(script).toMatch(/if \(!apply\) \{[\s\S]*?process\.exit\(0\)/);
    expect(script).toContain('confirm !== databaseName');
  });

  test('R2 拒绝系统库，且清空范围写死为四个受管 schema', () => {
    expect(script).toContain(
      "const FORBIDDEN_DATABASES = new Set(['postgres', 'template0', 'template1'])"
    );
    expect(script).toContain(
      "const MANAGED_SCHEMAS = ['public', 'auth', 'app', 'drizzle']"
    );
    // 不许出现 drop database —— 删库是不可逆操作，脚本只清对象。
    expect(script).not.toMatch(/drop\s+database/i);
  });

  test('R3 public schema 必须重建回来（CREATE EXTENSION 需要落点）', () => {
    // 2026-11-09 演练踩过：直接 drop schema public 后，基线里的
    // `create extension ltree` 报 no schema has been selected to create in。
    expect(script).toContain('create schema public');
    expect(script).toContain("after.present.includes('public')");
    expect(script).toMatch(/public schema 丢失/);
  });

  test('R4 不删角色：角色是集群级对象，删除会波及其它库', () => {
    expect(script).not.toMatch(/drop\s+role/i);
    expect(script).toMatch(
      /角色（`genealogy_app` \/ `auth_service`）\*\*不删\*\*/
    );
  });
});

describe('R5 迁移 job 不再相信 drizzle 的 success 字面量', () => {
  const workflow = read('.github/workflows/migrate-production.yml');

  test('R5 迁移前先清空，迁移后校验；两句都不能被注释或 echo 掉', () => {
    // 迁移完立刻用同一份 journal 校验，不留「迁移跑了一半」的静默状态。
    expect(workflow).toContain(
      'node scripts/verify-deployment.mjs --skip-http'
    );
    // 清空步骤必须在迁移之前，且必须是真的执行命令（不是 echo / 注释占位）。
    const resetAt = workflow.indexOf('pnpm db:reset-target --apply --confirm=');
    const migrateAt = workflow.indexOf('pnpm db:migrate');
    expect(resetAt, '缺少真正执行清空的步骤').toBeGreaterThan(-1);
    expect(migrateAt).toBeGreaterThan(resetAt);
    // 清空只能发生在人工触发的重建模式里，push 触发的日常迁移不许清库。
    const resetBlock = workflow.slice(
      workflow.indexOf('- name: Reset target database'),
      migrateAt
    );
    expect(resetBlock).toContain(
      "if: github.event_name == 'workflow_dispatch' && inputs.reset"
    );
  });
});
