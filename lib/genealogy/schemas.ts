import { z } from 'zod';
import { PERSON_SEX_VALUES } from '@/lib/genealogy/constants';
import { MAX_LINEAGE_NAME_LENGTH } from '@/lib/lineage/constants';

const orgId = z.uuid('组织 ID 无效');
const projectId = z.uuid('云谱空间 ID 无效');
const folderId = z.uuid('分类 ID 无效');
const lineageId = z.uuid('谱系 ID 无效');
const nodeId = z.uuid('人丁 ID 无效');
/**
 * 表单仍带一个提交标识（历史 R31 幂等键）。S8 A′ 起 R31 已退役：目标态
 * `node` 没有 `request_id` 列，Server Actions 与写入层都不再使用它。这里保留
 * 为**可选**字段只为兼容现有录入表单，不做必填校验，也不声称提供重放保护。
 * 见实施计划 §3.3。
 */
const requestId = z.uuid('提交标识无效，请重新打开录入表单').optional();

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

/**
 * The form still posts the legacy 0/1 flag so the UI stays unchanged, while
 * the target-model `person.sex` is the four-value text domain. Mapping here
 * keeps the boundary honest: every Server Action receives a `PersonSex`.
 *
 * 历史约定必须与 UI 一致：0=男、1=女（见录入弹窗与详情面板），-1=未知。
 * 之前的映射把 0/1 写反，读取端又反了一次，界面看起来正常但库里的性别是反的。
 */
const sex = z.preprocess(
  (value) => {
    if (value === 0 || value === '0') {
      return 'male';
    }
    if (value === 1 || value === '1') {
      return 'female';
    }
    if (value === -1 || value === '-1') {
      return 'unknown';
    }
    return value === '' || value === null ? undefined : value;
  },
  z.enum(PERSON_SEX_VALUES, { error: '请选择性别' })
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

export const createFolderSchema = z.object({
  orgId,
  projectId,
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
});

export const updateLineageSchema = z.object({
  orgId,
  lineageId,
  folderId: clearableUuid('分类无效'),
  name: text('谱系名称', MAX_LINEAGE_NAME_LENGTH).optional(),
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
  isAlive: booleanField,
  birthText: optionalText(60, '生辰不能超过 60 个字符'),
  deathText: optionalText(60, '忌辰不能超过 60 个字符'),
  birthYear: clearableYear,
  deathYear: clearableYear,
  burialPlace: optionalText(100, '葬地不能超过 100 个字符'),
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
    requestId,
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
    requestId,
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
    requestId,
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
    requestId,
    ...nodeNameFields,
    ...nodeDetailsFields,
    ...optionalSpouseFields,
  })
  .superRefine(requireSpousePair);

export const addSpouseSchema = z.object({
  orgId,
  lineageId,
  spouseOfId: nodeId,
  requestId,
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
  isAlive: booleanField,
  birthText: clearableText(60, '生辰不能超过 60 个字符'),
  deathText: clearableText(60, '忌辰不能超过 60 个字符'),
  birthYear: clearableYear,
  deathYear: clearableYear,
  burialPlace: clearableText(100, '葬地不能超过 100 个字符'),
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
