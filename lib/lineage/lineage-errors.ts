import { PERMISSION_DENIED_MESSAGES } from '@/lib/auth/permissions';

/** 家谱事务层返回的失败原因 → 中文文案（Action 层唯一的错误映射点）。 */
export const LINEAGE_ERRORS = {
  forbidden: '你没有编辑谱系的权限',
  not_found: '谱系不存在或已删除',
  invalid_folder: '分类不存在或类型不匹配',
  conflict: '谱系名称已存在',
  referenced: '该谱系已被谱书编目引用，请先移除编目',
  root_exists: '该谱系已经有始祖了',
  root_sibling: '始祖没有父辈，不能添加兄弟',
  root_forbidden: '始祖不可删除，请删除整个谱系',
  invalid_target: '目标人丁无效',
  invalid_parent: '父节点无效',
  cycle: '不能把节点移动到自己的子孙下面',
  invalid_order: '排序数据无效',
  not_supported: '当前版本暂不支持该操作',
  project_surname_missing: '项目未填写姓氏，请先完善项目基本信息',
} as const;

export function lineageError(reason: LineageErrorReason) {
  return { error: LINEAGE_ERRORS[reason] };
}

export type LineageErrorReason = keyof typeof LINEAGE_ERRORS;

/**
 * 删除谱系的失败文案：`forbidden` 归 `lineage.delete`，与 `lineage.write` 的
 * 「你没有编辑谱系的权限」不同——编辑者有写权限，只是不能删谱系。
 */
export function deleteLineageError(reason: LineageErrorReason) {
  return {
    error:
      reason === 'forbidden'
        ? PERMISSION_DENIED_MESSAGES['lineage.delete']
        : LINEAGE_ERRORS[reason],
  };
}
