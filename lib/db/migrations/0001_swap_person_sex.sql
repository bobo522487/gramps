-- 一次性数据修复：旧表单把性别 0/1 写反（0=男被存成 female，1=女被存成 male）。
-- 代码边界已在 `lib/genealogy/schemas.ts` 修正；这里把历史行交换回来。
--
-- 只应执行一次：再跑一次会把正确值重新写反，因此交给 drizzle journal 记录、
-- 不要手工重复执行。
--
-- 前置确认（执行前人工核对）：目标库里所有 person.sex 都来自旧表单。
-- 种子/外部导入本身是正确的性别值，如果库里有这类数据，执行前先备份并逐批核对，
-- 否则本迁移会把它们改错。
UPDATE public.person
SET sex = CASE sex
  WHEN 'male' THEN 'female'
  WHEN 'female' THEN 'male'
  ELSE sex
END
WHERE sex IN ('male', 'female');
