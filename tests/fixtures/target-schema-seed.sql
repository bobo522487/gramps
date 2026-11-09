-- S8 目标态验收 seed（T38 / T41）。
-- 固定 UUID 供反例与安全用例直接引用；由 scripts/verify-target-schema.mjs
-- 在全新库执行，不是可独立 `psql -f` 的迁移文件。
-- ORG_A / ORG_B、PROJ_A / PROJ_B 覆盖跨组织与 project.id 全局唯一两类场景。

insert into organization (id, slug, name) values
  ('11111111-1111-1111-1111-111111111111', 'verify-org-a', '验收组织 A'),
  ('22222222-2222-2222-2222-222222222222', 'verify-org-b', '验收组织 B')
on conflict do nothing;

insert into project (organization_id, id, ref, name) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'verify-ref-a', '验收项目 A'),
  ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444', 'verify-ref-b', '验收项目 B')
on conflict do nothing;

insert into person (organization_id, project_id, id, sex) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555', 'unknown')
on conflict do nothing;

insert into family (organization_id, project_id, id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666')
on conflict do nothing;

insert into lineage (organization_id, project_id, id, name) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '验收谱系')
on conflict do nothing;

insert into article (organization_id, project_id, id, title, body) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '88888888-8888-8888-8888-888888888888', '验收谱文', '{}')
on conflict do nothing;

insert into book (organization_id, project_id, id, title) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '验收谱书')
on conflict do nothing;
