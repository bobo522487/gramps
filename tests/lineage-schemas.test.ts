import { describe, expect, it } from 'vitest';
import {
  addChildSchema,
  addPersonSchema,
  addSiblingSchema,
  addSpouseSchema,
  createFolderSchema,
  createLineageSchema,
  createRootNodeSchema,
  updateLineageSchema,
} from '@/lib/genealogy/schemas';

const orgId = '00000000-0000-4000-8000-000000000001';
const lineageId = '00000000-0000-4000-8000-000000000002';
const parentId = '00000000-0000-4000-8000-000000000003';
const projectId = '00000000-0000-4000-8000-000000000004';

describe('node creation schemas', () => {
  it('parses creation details and co-recorded spouse fields', () => {
    const parsed = createRootNodeSchema.parse({
      orgId,
      lineageId,
      name: '元英',
      surname: '陈',
      sex: '0',
      courtesy: '子安',
      namePrefix: '公',
      isAlive: 'on',
      birthText: '光绪二十年',
      deathText: '一九六八年',
      birthYear: '1894',
      deathYear: '1968',
      burialPlace: '村东祖坟',
      biography: '勤俭持家，耕读传家。',
      spouseName: '氏',
      spouseSurname: '王',
    });

    expect(parsed.name).toBe('元英');
    expect(parsed.sex).toBe(0);
    expect(parsed.isAlive).toBe(true);
    expect(parsed.birthYear).toBe(1894);
    expect(parsed.deathYear).toBe(1968);
    expect(parsed.courtesy).toBe('子安');
    expect(parsed.burialPlace).toBe('村东祖坟');
    expect(parsed.spouseName).toBe('氏');
    expect(parsed.spouseSurname).toBe('王');
  });

  it('defaults the living status to deceased and keeps optional fields empty', () => {
    const parsed = createRootNodeSchema.parse({
      orgId,
      lineageId,
      name: '无名',
      sex: 0,
    });
    expect(parsed.isAlive).toBe(false);
    expect(parsed.surname).toBeUndefined();
    expect(parsed.spouseName).toBeUndefined();
    expect(parsed.spouseSurname).toBeUndefined();
    expect(parsed.birthYear).toBeUndefined();
  });

  it('requires spouse surname and given name to be provided together', () => {
    const missingSurname = createRootNodeSchema.safeParse({
      orgId,
      lineageId,
      name: '元英',
      sex: 0,
      spouseName: '氏',
    });
    expect(missingSurname.success).toBe(false);
    if (!missingSurname.success) {
      expect(missingSurname.error.issues[0]?.path).toEqual(['spouseSurname']);
      expect(missingSurname.error.issues[0]?.message).toBe(
        '请同时填写配偶的姓氏与名讳'
      );
    }

    const missingName = addChildSchema.safeParse({
      orgId,
      lineageId,
      parentId,
      name: '元华',
      sex: 0,
      spouseSurname: '王',
    });
    expect(missingName.success).toBe(false);
    if (!missingName.success) {
      expect(missingName.error.issues[0]?.path).toEqual(['spouseName']);
    }
  });

  it('accepts a spouse pair on child and sibling creation', () => {
    const child = addChildSchema.parse({
      orgId,
      lineageId,
      parentId,
      name: '元英',
      sex: 0,
      spouseName: '氏',
      spouseSurname: '林',
    });
    expect(child.parentId).toBe(parentId);
    expect(child.spouseSurname).toBe('林');

    const sibling = addSiblingSchema.parse({
      orgId,
      lineageId,
      siblingOfId: parentId,
      name: '元华',
      sex: 0,
      spouseName: '氏',
      spouseSurname: '黄',
    });
    expect(sibling.siblingOfId).toBe(parentId);
    expect(sibling.spouseName).toBe('氏');
  });

  it('parses a general person with or without a parent', () => {
    const withParent = addPersonSchema.parse({
      orgId,
      lineageId,
      parentId,
      name: '元英',
      sex: 0,
    });
    expect(withParent.parentId).toBe(parentId);

    const withoutParent = addPersonSchema.parse({
      orgId,
      lineageId,
      parentId: '',
      name: '始祖',
      sex: 0,
    });
    expect(withoutParent.parentId).toBeUndefined();

    const invalid = addPersonSchema.safeParse({
      orgId,
      lineageId,
      parentId: 'not-a-uuid',
      name: '元英',
      sex: 0,
    });
    expect(invalid.success).toBe(false);
  });

  it('parses spouse details without a second co-recorded spouse', () => {
    const parsed = addSpouseSchema.parse({
      orgId,
      lineageId,
      spouseOfId: parentId,
      name: '氏',
      surname: '王',
      sex: '1',
      isAlive: '1',
      birthYear: '',
      burialPlace: '合葬村东',
    });

    expect(parsed.sex).toBe(1);
    expect(parsed.isAlive).toBe(true);
    expect(parsed.birthYear).toBeNull();
    expect(parsed.burialPlace).toBe('合葬村东');
    expect('spouseName' in parsed).toBe(false);
  });

  it('rejects malformed years', () => {
    const parsed = createRootNodeSchema.safeParse({
      orgId,
      lineageId,
      name: '元英',
      sex: 0,
      birthYear: '0',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('field-level validation messages', () => {
  it('keeps schema-specific messages for folder kind and sex', () => {
    expect(
      createFolderSchema.safeParse({
        orgId,
        projectId,
        kind: '9',
        name: '谱系',
      }).error?.issues[0].message
    ).toBe('分类类型无效');
    expect(
      createRootNodeSchema.safeParse({
        orgId,
        lineageId,
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
    region: '中国/福建/漳州',
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

  it('accepts an empty folder id (server creates the default category) and rejects a blank region', () => {
    const parsed = createLineageSchema.safeParse({ ...base, folderId: '' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.folderId).toBeUndefined();
    }

    expect(createLineageSchema.safeParse({ ...base, region: '   ' }).success).toBe(
      false
    );
    expect(
      createLineageSchema.safeParse({ ...base, region: '地'.repeat(101) }).success
    ).toBe(false);
  });

  it('strips a forged surname so it can never reach the database', () => {
    const parsed = createLineageSchema.parse({ ...base, surname: '王' });
    expect(parsed).not.toHaveProperty('surname');
  });

  it('keeps notes optional and generation words out of creation', () => {
    const parsed = createLineageSchema.parse({ ...base, notes: '光绪年间分谱' });
    expect(parsed.notes).toBe('光绪年间分谱');
    expect(createLineageSchema.parse(base)).not.toHaveProperty('generationWords');
  });
});

describe('updateLineageSchema', () => {
  it('accepts region/notes clearing and still rejects surname', () => {
    const parsed = updateLineageSchema.parse({
      orgId,
      lineageId,
      region: '',
      notes: '',
      surname: '王',
    });
    expect(parsed.region).toBeNull();
    expect(parsed.notes).toBeNull();
    expect(parsed).not.toHaveProperty('surname');
  });
});
