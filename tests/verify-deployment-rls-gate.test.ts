import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/verify-deployment.mjs');

/**
 * 生产 workflow 用 --require-runtime-rls 声明「运行期 RLS 校验必须真的连过库」。
 * 缺 APP_POSTGRES_URL 时必须把校验判红，而不是打印 passed：2026-11-09 的
 * 假绿就是因为缺连接串被 skip() 静默放行。--skip-db / --skip-http 让这两个
 * 子进程用例不碰网络也不碰数据库，只验证主流程的判定分支。
 */
function verify(args: string[]): { status: number; stdout: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      APP_POSTGRES_URL: '',
      APP_DATABASE_URL: '',
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
  };
}

describe('生产校验的运行期 RLS 门禁', () => {
  test('带 --require-runtime-rls 且缺 app 连接串时必须判红', () => {
    const { status, stdout } = verify([
      '--skip-db',
      '--skip-http',
      '--require-runtime-rls',
    ]);
    expect(status).not.toBe(0);
    expect(stdout).toContain('Deployment verification failed.');
    expect(stdout).toContain('runtime RLS checks');
  });

  test('本地 pnpm verify:deploy 不带该 flag 时缺连接串仍放行', () => {
    const { status, stdout } = verify(['--skip-db', '--skip-http']);
    expect(status).toBe(0);
    expect(stdout).toContain('Deployment verification passed.');
  });
});
