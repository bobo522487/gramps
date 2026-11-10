import { z } from 'zod';
import {
  clearableText,
  optionalText,
  orgId,
  projectId,
} from '@/lib/forms/primitives';
import {
  DEFAULT_PROJECT_IMPORTANCE,
  DEFAULT_PROJECT_STATUS,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_NOTES_LENGTH,
  MAX_PROJECT_REGIONS_LENGTH,
  MAX_PROJECT_SURNAME_LENGTH,
  MAX_PROJECT_THEME_NAME_LENGTH,
  PROJECT_IMPORTANCE_MAX,
  PROJECT_STATUS_VALUES,
} from '@/lib/project/constants';

/**
 * Project-domain form schemas.
 *
 * These used to live in `lib/auth/schemas.ts`, dragging `lib/project/constants`
 * into the auth module. They now sit next to the project domain they describe.
 */

const projectStatus = z.enum(PROJECT_STATUS_VALUES, {
  error: '请选择项目状态',
});

const projectImportance = z.coerce
  .number({
    error: '请选择重要等级',
  })
  .int('重要等级必须是整数')
  .min(1, '重要等级最低为 1 星')
  .max(PROJECT_IMPORTANCE_MAX, `重要等级最高为 ${PROJECT_IMPORTANCE_MAX} 星`);

export const createProjectSchema = z.object({
  orgId,
  name: z
    .string({ error: '请输入项目名' })
    .trim()
    .min(1, '请输入项目名')
    .max(
      MAX_PROJECT_NAME_LENGTH,
      `项目名不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    ),
  surname: z
    .string({ error: '请输入姓氏' })
    .trim()
    .min(1, '请输入姓氏')
    .max(
      MAX_PROJECT_SURNAME_LENGTH,
      `姓氏不能超过 ${MAX_PROJECT_SURNAME_LENGTH} 个字符`
    ),
  themeName: z
    .string({ error: '请输入主题名' })
    .trim()
    .min(1, '请输入主题名')
    .max(
      MAX_PROJECT_THEME_NAME_LENGTH,
      `主题名不能超过 ${MAX_PROJECT_THEME_NAME_LENGTH} 个字符`
    ),
  countriesRegions: z
    .string({ error: '请输入地区' })
    .trim()
    .min(1, '请输入地区')
    .max(
      MAX_PROJECT_REGIONS_LENGTH,
      `地区不能超过 ${MAX_PROJECT_REGIONS_LENGTH} 个字符`
    ),
  status: projectStatus.default(DEFAULT_PROJECT_STATUS),
  importance: projectImportance.default(DEFAULT_PROJECT_IMPORTANCE),
  notes: optionalText(
    MAX_PROJECT_NOTES_LENGTH,
    `备注不能超过 ${MAX_PROJECT_NOTES_LENGTH} 个字符`
  ),
});

export const updateProjectSchema = z.object({
  orgId,
  projectId,
  name: z
    .string()
    .trim()
    .min(1, '请输入项目名')
    .max(
      MAX_PROJECT_NAME_LENGTH,
      `项目名不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    )
    .optional(),
  countriesRegions: clearableText(
    MAX_PROJECT_REGIONS_LENGTH,
    `地区不能超过 ${MAX_PROJECT_REGIONS_LENGTH} 个字符`
  ),
  hallCode: clearableText(60, '郡望/堂号不能超过 60 个字符'),
  status: projectStatus.optional(),
  importance: projectImportance.optional(),
  notes: clearableText(
    MAX_PROJECT_NOTES_LENGTH,
    `备注不能超过 ${MAX_PROJECT_NOTES_LENGTH} 个字符`
  ),
});

export const deleteProjectSchema = z.object({
  orgId,
  projectId,
});
