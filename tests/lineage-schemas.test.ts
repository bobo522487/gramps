import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  addChildSchema,
  addPersonSchema,
  addSiblingSchema,
  createFolderSchema,
  createLineageSchema,
  createRootNodeSchema,
  updateLineageSchema,
} from '@/lib/genealogy/schemas';

const orgId = '00000000-0000-4000-8000-000000000001';
const lineageId = '00000000-0000-4000-8000-000000000002';
const parentId = '00000000-0000-4000-8000-000000000003';
const projectId = '00000000-0000-4000-8000-000000000004';
const requestId = '00000000-0000-4000-8000-000000000005';

describe('node creation schemas', () => {
  it('accepts a person sex and rejects the legacy 0/1 flag', () => {
    const parsed = createRootNodeSchema.parse({
      orgId,
      lineageId,
      requestId,
      name: '元英',
      surname: '陈',
      sex: 'male',
    });
    expect(parsed.sex).toBe('male');

    const rejected = createRootNodeSchema.safeParse({
      orgId,
      lineageId,
      requestId,
      name: '元英',
      sex: '0',
    });
    expect(rejected.success).toBe(false);
  });

  it('parses creation details', () => {
    const parsed = createRootNodeSchema.parse({
      orgId,
      lineageId,
      requestId,
      name: '元英',
      surname: '陈',
      sex: 'male',
      courtesy: '子安',
      namePrefix: '公',
      isAlive: 'on',
      birthText: '光绪二十年',
      deathText: '一九六八年',
      birthYear: '1894',
      deathYear: '1968',
      burialPlace: '村东祖坟',
      biography: '勤俭持家，耕读传家。',
    });

    expect(parsed.name).toBe('元英');
    expect(parsed.sex).toBe('male');
    expect(parsed.isAlive).toBe(true);
    expect(parsed.birthYear).toBe(1894);
    expect(parsed.deathYear).toBe(1968);
    expect(parsed.courtesy).toBe('子安');
    expect(parsed.burialPlace).toBe('村东祖坟');
  });

  it('does not accept a co-recorded spouse', () => {
    const parsed = createRootNodeSchema.parse({
      orgId,
      lineageId,
      requestId,
      name: '元英',
      surname: '陈',
      sex: 'male',
      spouseName: '氏',
      spouseSurname: '王',
    });
    expect(parsed).not.toHaveProperty('spouseName');
    expect(parsed).not.toHaveProperty('spouseSurname');
  });

  it('defaults the living status to deceased and keeps optional fields empty', () => {
    const parsed = createRootNodeSchema.parse({
      orgId,
      lineageId,
      requestId,
      name: '无名',
      sex: 'male',
    });
    expect(parsed.isAlive).toBe(false);
    expect(parsed.surname).toBeUndefined();
    expect(parsed.birthYear).toBeUndefined();
  });

  it('accepts a child and a sibling', () => {
    const child = addChildSchema.parse({
      orgId,
      lineageId,
      parentId,
      requestId,
      name: '元英',
      sex: 'male',
    });
    expect(child.parentId).toBe(parentId);

    const sibling = addSiblingSchema.parse({
      orgId,
      lineageId,
      siblingOfId: parentId,
      requestId,
      name: '元华',
      sex: 'male',
    });
    expect(sibling.siblingOfId).toBe(parentId);
  });

  it('parses a general person with or without a parent', () => {
    const withParent = addPersonSchema.parse({
      orgId,
      lineageId,
      parentId,
      requestId,
      name: '元英',
      sex: 'male',
    });
    expect(withParent.parentId).toBe(parentId);

    const withoutParent = addPersonSchema.parse({
      orgId,
      lineageId,
      parentId: '',
      requestId,
      name: '始祖',
      sex: 'male',
    });
    expect(withoutParent.parentId).toBeUndefined();

    const invalid = addPersonSchema.safeParse({
      orgId,
      lineageId,
      parentId: 'not-a-uuid',
      requestId,
      name: '元英',
      sex: 'male',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects malformed years', () => {
    const parsed = createRootNodeSchema.safeParse({
      orgId,
      lineageId,
      requestId,
      name: '元英',
      sex: 'male',
      birthYear: '0',
    });
    expect(parsed.success).toBe(false);
  });

  // S8 A′：R31 幂等键随目标态 `node` 退役（无 request_id 列）。提交标识退为
  // 表单兼容的可选字段：不传可通过，传了仍要合法 UUID。重放保护留阶段 C。
  it('accepts creations without a submission id and still validates its format', () => {
    const cases: {
      label: string;
      schema: z.ZodType;
      input: Record<string, unknown>;
    }[] = [
      {
        label: '始祖',
        schema: createRootNodeSchema,
        input: { orgId, lineageId, name: '元英', sex: 'male' },
      },
      {
        label: '子女',
        schema: addChildSchema,
        input: { orgId, lineageId, parentId, name: '元英', sex: 'male' },
      },
      {
        label: '兄弟',
        schema: addSiblingSchema,
        input: {
          orgId,
          lineageId,
          siblingOfId: parentId,
          name: '元英',
          sex: 'male',
        },
      },
      {
        label: '族人',
        schema: addPersonSchema,
        input: { orgId, lineageId, parentId, name: '元英', sex: 'male' },
      },
    ];

    for (const { label, schema, input } of cases) {
      expect(schema.safeParse(input).success, label).toBe(true);
      expect(schema.safeParse({ ...input, requestId }).success, label).toBe(
        true
      );
      const malformed = schema.safeParse({
        ...input,
        requestId: 'not-a-uuid',
      });
      expect(malformed.success, label).toBe(false);
      if (!malformed.success) {
        expect(malformed.error.issues[0]?.path, label).toEqual(['requestId']);
      }
    }
  });
});

describe('field-level validation messages', () => {
  it('keeps schema-specific messages for folder name and sex', () => {
    // 扁平单层后分类不再有 kind，剩下要钉的是名字校验与性别枚举的文案。
    expect(
      createFolderSchema.safeParse({
        orgId,
        projectId,
        name: '   ',
      }).error?.issues[0].message
    ).toBe('请输入分类名称');
    expect(
      createRootNodeSchema.safeParse({
        orgId,
        lineageId,
        requestId,
        name: '元英',
        sex: '2',
      }).error?.issues[0].message
    ).toBe('请选择性别');
  });
});

describe('createLineageSchema', () => {
  const base = {
    orgId: '00000000-0000-4000-8000-000000000001',
    projectId: '00000000-0000-4000-8000-000000000004',
    folderId: '00000000-0000-4000-8000-000000000009',
    name: '颍川陈氏世系',
  };

  it('accepts 24 characters and rejects 25', () => {
    expect(
      createLineageSchema.safeParse({ ...base, name: '名'.repeat(24) }).success
    ).toBe(true);

    const tooLong = createLineageSchema.safeParse({
      ...base,
      name: '名'.repeat(25),
    });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0]?.message).toBe(
        '谱系名称不能超过 24 个字符'
      );
    }
  });

  it('accepts an empty folder id (server creates the default category)', () => {
    const parsed = createLineageSchema.safeParse({ ...base, folderId: '' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.folderId).toBeUndefined();
    }
  });

  it('strips a forged surname so it can never reach the database', () => {
    const parsed = createLineageSchema.parse({ ...base, surname: '王' });
    expect(parsed).not.toHaveProperty('surname');
  });
});

describe('updateLineageSchema', () => {
  it('still rejects a forged surname', () => {
    const parsed = updateLineageSchema.parse({
      orgId,
      lineageId,
      surname: '王',
    });
    expect(parsed).not.toHaveProperty('surname');
  });
});
