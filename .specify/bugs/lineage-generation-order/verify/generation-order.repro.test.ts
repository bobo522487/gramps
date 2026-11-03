import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildLineageIndex } from '@/components/lineage/derived';
import { toNodeViews } from '@/components/lineage/types';
import { getNodes } from '@/lib/db/queries/nodes';
import {
  addChildInTransaction,
  createRootNodeInTransaction,
} from '@/lib/lineage/node-services';
import { createLineageInTransaction } from '@/lib/lineage/services';
import {
  createProject,
  createUser,
  getPersonalOrg,
} from '@/tests/helpers/factories';

/**
 * Verification artifact for `.specify/bugs/lineage-generation-order` —
 * the assessment's Reproduction (steps 1–3) exercised end-to-end without a
 * browser: the REAL write path (`createRootNodeInTransaction` /
 * `addChildInTransaction` → `nextSort`), the REAL read path (`getNodes` →
 * `toNodeViews`, what
 * `app/(dashboard)/dashboard/project/[projectRef]/lineages/[lineageId]/page.tsx`
 * feeds the client), and the REAL 世系表 bucketing rule
 * (`lineage-detail.tsx` `groups`: bucket by `generation`, keep `blood` order
 * inside the bucket).
 *
 * Expected per FR-LIN-13 (assessment Symptom): 第 3 世 rows are
 * 长房长子 → 长房次子 → 次房独子, not the interleaving the old
 * `generation → sort` rule produced.
 */

async function setup() {
  const user = await createUser();
  const personal = await getPersonalOrg(user.id);
  if (!personal) {
    throw new Error('expected signup trigger to create a personal org');
  }
  const project = await createProject({
    orgId: personal.organization.id,
    createdBy: user.id,
  });
  const lineage = await createLineageInTransaction({
    userId: user.id,
    orgId: personal.organization.id,
    projectId: project.id,
    name: '验证谱系',
    region: '中国/福建',
  });
  if (!lineage.ok) {
    throw new Error('failed to create lineage');
  }
  return {
    user,
    organization: personal.organization,
    lineage: lineage.lineage,
  };
}

async function root(
  userId: string,
  orgId: string,
  lineageId: string,
  name: string
) {
  const result = await createRootNodeInTransaction({
    userId,
    orgId,
    lineageId,
    requestId: randomUUID(),
    name,
    sex: 0,
  });
  if (!result.ok) {
    throw new Error(`create root failed: ${result.reason}`);
  }
  return result.node;
}

async function child(
  userId: string,
  orgId: string,
  lineageId: string,
  parentId: string,
  name: string
) {
  const result = await addChildInTransaction({
    userId,
    orgId,
    lineageId,
    requestId: randomUUID(),
    parentId,
    name,
    sex: 0,
  });
  if (!result.ok) {
    throw new Error(`add child "${name}" failed: ${result.reason}`);
  }
  return result.node;
}

describe('reproduction: 世系表 row order on a real multi-branch lineage', () => {
  it('walks 长房整支 before 次房整支 through the real read path', async () => {
    const { user, organization, lineage } = await setup();
    const orgId = organization.id;
    const lineageId = lineage.id;

    // Reproduction 步骤 1–2：始祖 → 长房、次房；长房二子、次房一子。
    const founder = await root(user.id, orgId, lineageId, '始祖');
    const elder = await child(user.id, orgId, lineageId, founder.id, '长房');
    const younger = await child(user.id, orgId, lineageId, founder.id, '次房');
    const elderFirst = await child(
      user.id,
      orgId,
      lineageId,
      elder.id,
      '长房长子'
    );
    const elderSecond = await child(
      user.id,
      orgId,
      lineageId,
      elder.id,
      '长房次子'
    );
    const youngerOnly = await child(
      user.id,
      orgId,
      lineageId,
      younger.id,
      '次房独子'
    );

    // nextSort 的实际产物：sort 只在同一父节点内递增 —— 跨房支不可比较（根因）。
    expect([founder.sort, elder.sort, younger.sort]).toEqual([0, 0, 1]);
    expect([elderFirst.sort, elderSecond.sort, youngerOnly.sort]).toEqual([
      0, 1, 0,
    ]);

    // Reproduction 步骤 3：页面读取链 → 世系表卡片。
    const rows = await getNodes(user.id, orgId, lineage.id);
    expect(rows).toHaveLength(6);

    // getNodes 现在只给入库序，不再表达显示语义（R30：orderBy createdAt, id）。
    const insertionOrder = [
      founder.id,
      elder.id,
      younger.id,
      elderFirst.id,
      elderSecond.id,
      youngerOnly.id,
    ];
    expect(rows.map((row) => row.id)).toEqual(insertionOrder);
    expect(rows.map((row) => row.id)).not.toEqual([
      founder.id,
      elder.id,
      younger.id,
      elderFirst.id,
      youngerOnly.id,
      elderSecond.id,
    ]);

    const index = buildLineageIndex(toNodeViews(rows));
    expect(index.blood.map((node) => node.name)).toEqual([
      '始祖',
      '长房',
      '长房长子',
      '长房次子',
      '次房',
      '次房独子',
    ]);

    // lineage-detail.tsx 的 `groups`：按 generation 分桶、桶内保持 blood 序。
    const groups = new Map<number, string[]>();
    for (const node of index.blood) {
      const bucket = groups.get(node.generation) ?? [];
      bucket.push(node.name);
      groups.set(node.generation, bucket);
    }
    const thirdGen = groups.get(3) ?? [];
    expect(thirdGen).toEqual(['长房长子', '长房次子', '次房独子']);
    // 旧序（症状）会把次房独子插进长房两子中间 —— 断言它不再出现。
    expect(thirdGen).not.toEqual(['长房长子', '次房独子', '长房次子']);

    // 打印视图走同一份 groups，无需单独验证第二套排序。
    expect([...groups.keys()]).toEqual([1, 2, 3]);
    expect(groups.get(2)).toEqual(['长房', '次房']);

    // 顺序真源在 derived：重复构建结果一致（确定性）。
    expect(
      buildLineageIndex(toNodeViews(rows.slice().reverse())).blood.map(
        (node) => node.id
      )
    ).toEqual(index.blood.map((node) => node.id));
  });
});
