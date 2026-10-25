import { z } from 'zod';
import {
  MAX_LINEAGE_HALL_CODE_LENGTH,
  MAX_LINEAGE_NAME_LENGTH,
  MAX_LINEAGE_NOTES_LENGTH,
  MAX_LINEAGE_REGION_LENGTH,
} from '@/lib/lineage/constants';

export const FOLDER_KINDS = [0, 1, 2] as const;
export type FolderKind = (typeof FOLDER_KINDS)[number];

const orgId = z.uuid('组织 ID 无效');
const projectId = z.uuid('云谱空间 ID 无效');
const folderId = z.uuid('分类 ID 无效');
const lineageId = z.uuid('谱系 ID 无效');
const nodeId = z.uuid('人丁 ID 无效');

const optionalUuid = (message: string) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.uuid(message).optional()
  );

const clearableUuid = (message: string) =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    z.union([z.uuid(message), z.null()]).optional()
  );

const text = (label: string, max: number) =>
  z
    .string({ error: `请输入${label}` })
    .trim()
    .min(1, `请输入${label}`)
    .max(max, `${label}不能超过 ${max} 个字符`);

const optionalText = (max: number, message: string) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.string().trim().max(max, message).optional()
  );

const clearableText = (max: number, message: string) =>
  z.preprocess(
    (value) => (value === null ? undefined : value),
    z
      .string()
      .trim()
      .max(max, message)
      .optional()
      .transform((value) => (value === undefined ? undefined : value || null))
  );

const sex = z.preprocess(
  (value) => (value === '' || value === null ? undefined : Number(value)),
  z
    .number({ error: '请选择性别' })
    .int()
    .refine((value) => value === 0 || value === 1, '请选择性别')
);

const clearableYear = z.preprocess(
  (value) =>
    value === ''
      ? null
      : value === undefined || value === null
        ? undefined
        : Number(value),
  z
    .union([
      z
        .number()
        .int('年份必须是整数')
        .min(1, '年份格式不正确')
        .max(9999, '年份格式不正确'),
      z.null(),
    ])
    .optional()
);

const booleanField = z.preprocess(
  (value) =>
    value === true || value === 'true' || value === 'on' || value === '1',
  z.boolean()
);

const generationWords = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z
    .string()
    .trim()
    .max(240, '字辈不能超过 240 个字符')
    .optional()
    .transform((value, ctx) => {
      if (!value) {
        return undefined;
      }
      const words = value.split(/[\s,，、]+/).filter(Boolean);
      if (words.length > 40) {
        ctx.addIssue({
          code: 'custom',
          message: '字辈最多 40 个字',
        });
        return z.NEVER;
      }
      const tooLong = words.find((word) => word.length > 8);
      if (tooLong) {
        ctx.addIssue({
          code: 'custom',
          message: `字辈「${tooLong}」过长`,
        });
        return z.NEVER;
      }
      return words;
    })
);

export const createFolderSchema = z.object({
  orgId,
  projectId,
  kind: z.coerce
    .number({ error: '分类类型无效' })
    .int()
    .refine(
      (value) => FOLDER_KINDS.includes(value as FolderKind),
      '分类类型无效'
    ),
  parentId: optionalUuid('上级分类无效'),
  name: text('分类名称', 100),
});

export const renameFolderSchema = z.object({
  orgId,
  folderId,
  name: text('分类名称', 100),
});

export const deleteFolderSchema = z.object({
  orgId,
  folderId,
});

export const createLineageSchema = z.object({
  orgId,
  projectId,
  // 空值表示项目还没有分类，由服务端在同一事务内创建「默认分类」。
  folderId: optionalUuid('分类无效'),
  name: text('谱系名称', MAX_LINEAGE_NAME_LENGTH),
  hallCode: optionalText(
    MAX_LINEAGE_HALL_CODE_LENGTH,
    '郡望/堂号不能超过 60 个字符'
  ),
  region: text('地区', MAX_LINEAGE_REGION_LENGTH),
  notes: optionalText(MAX_LINEAGE_NOTES_LENGTH, '备注不能超过 500 个字符'),
});

export const updateLineageSchema = z.object({
  orgId,
  lineageId,
  folderId: clearableUuid('分类无效'),
  name: text('谱系名称', MAX_LINEAGE_NAME_LENGTH).optional(),
  hallCode: clearableText(60, '郡望/堂号不能超过 60 个字符'),
  region: clearableText(MAX_LINEAGE_REGION_LENGTH, '地区不能超过 100 个字符'),
  notes: clearableText(MAX_LINEAGE_NOTES_LENGTH, '备注不能超过 500 个字符'),
  generationWords: z.preprocess(
    (value) => (value === null ? undefined : value),
    z
      .string()
      .trim()
      .max(240, '字辈不能超过 240 个字符')
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) {
          return undefined;
        }
        if (!value) {
          return [] as string[];
        }
        const words = value.split(/[\s,，、]+/).filter(Boolean);
        if (words.length > 40) {
          ctx.addIssue({
            code: 'custom',
            message: '字辈最多 40 个字',
          });
          return z.NEVER;
        }
        return words;
      })
  ),
});

export const deleteLineageSchema = z.object({
  orgId,
  lineageId,
});

const nodeNameFields = {
  name: text('姓名', 60),
  surname: optionalText(30, '姓氏不能超过 30 个字符'),
  sex,
};

const nodeDetailsFields = {
  courtesy: optionalText(60, '字号不能超过 60 个字符'),
  namePrefix: optionalText(60, '前缀不能超过 60 个字符'),
  isAlive: booleanField,
  birthText: optionalText(60, '生辰不能超过 60 个字符'),
  deathText: optionalText(60, '忌辰不能超过 60 个字符'),
  birthYear: clearableYear,
  deathYear: clearableYear,
  burialPlace: optionalText(100, '葬地不能超过 100 个字符'),
  biography: optionalText(2000, '行传不能超过 2000 个字符'),
};

const optionalSpouseFields = {
  spouseName: optionalText(60, '配偶名讳不能超过 60 个字符'),
  spouseSurname: optionalText(30, '配偶姓氏不能超过 30 个字符'),
};

function requireSpousePair(
  value: { spouseName?: string; spouseSurname?: string },
  ctx: z.RefinementCtx
) {
  const hasName = Boolean(value.spouseName);
  const hasSurname = Boolean(value.spouseSurname);
  if (hasName === hasSurname) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    path: hasName ? ['spouseSurname'] : ['spouseName'],
    message: '请同时填写配偶的姓氏与名讳',
  });
}

export const createRootNodeSchema = z
  .object({
    orgId,
    lineageId,
    ...nodeNameFields,
    ...nodeDetailsFields,
    ...optionalSpouseFields,
  })
  .superRefine(requireSpousePair);

export const addChildSchema = z
  .object({
    orgId,
    lineageId,
    parentId: nodeId,
    ...nodeNameFields,
    ...nodeDetailsFields,
    ...optionalSpouseFields,
  })
  .superRefine(requireSpousePair);

export const addSiblingSchema = z
  .object({
    orgId,
    lineageId,
    siblingOfId: nodeId,
    ...nodeNameFields,
    ...nodeDetailsFields,
    ...optionalSpouseFields,
  })
  .superRefine(requireSpousePair);

export const addPersonSchema = z
  .object({
    orgId,
    lineageId,
    parentId: optionalUuid('父节点无效'),
    ...nodeNameFields,
    ...nodeDetailsFields,
    ...optionalSpouseFields,
  })
  .superRefine(requireSpousePair);

export const addSpouseSchema = z.object({
  orgId,
  lineageId,
  spouseOfId: nodeId,
  name: text('姓名', 60),
  surname: text('姓氏', 30),
  sex,
  ...nodeDetailsFields,
});

export const updateNodeSchema = z.object({
  orgId,
  lineageId,
  nodeId,
  name: text('姓名', 60),
  surname: text('姓氏', 30),
  sex,
  courtesy: clearableText(60, '字号不能超过 60 个字符'),
  namePrefix: clearableText(60, '前缀不能超过 60 个字符'),
  isAlive: booleanField,
  birthText: clearableText(60, '生辰不能超过 60 个字符'),
  deathText: clearableText(60, '忌辰不能超过 60 个字符'),
  birthYear: clearableYear,
  deathYear: clearableYear,
  burialPlace: clearableText(100, '葬地不能超过 100 个字符'),
  biography: clearableText(2000, '行传不能超过 2000 个字符'),
});

export const deleteNodeSchema = z.object({
  orgId,
  lineageId,
  nodeId,
});

export const moveNodeSchema = z.object({
  orgId,
  lineageId,
  nodeId,
  newParentId: nodeId,
});

export const reorderSiblingsSchema = z.object({
  orgId,
  lineageId,
  parentId: optionalUuid('父节点无效'),
  orderedIds: z.string({ error: '排序数据无效' }).transform((value, ctx) => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        !Array.isArray(parsed) ||
        parsed.some((id) => typeof id !== 'string')
      ) {
        throw new Error('invalid');
      }
      return parsed as string[];
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: '排序数据无效',
      });
      return z.NEVER;
    }
  }),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type CreateLineageInput = z.infer<typeof createLineageSchema>;
export type UpdateLineageInput = z.infer<typeof updateLineageSchema>;
export type NodeNameInput = z.infer<typeof addChildSchema>;
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
