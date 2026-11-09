-- S8 目标态反例夹具（T38 第一批，15 条）。
-- 每条用 `-- @case / @expect / @desc` 标注，由
-- scripts/verify-target-schema.mjs 在独立事务里逐条执行并比对 SQLSTATE，
-- 每条结束 ROLLBACK，互不污染。整文件不要 `psql -f`。
-- UUID 对应 tests/fixtures/target-schema-seed.sql 的固定 seed。
-- 场景编号沿用 tests/fixtures/target-schema-assertions.md 的附录 B.2；
-- 同一场景拆成多条时用 `-a/-b` 后缀。P1–P32 正例与其余 N 场景待后续批次。

-- @case N25
-- @expect 23514
-- @desc invite.email 含大写字母，违反归一化 CHECK
insert into invite (organization_id, email, expires_at)
values ('11111111-1111-1111-1111-111111111111', 'Upper@Example.com', now() + interval '1 day');

-- @case N16-a
-- @expect 23514
-- @desc invite.role = 'owner' 被 CHECK 拒绝
insert into invite (organization_id, email, role, expires_at)
values ('11111111-1111-1111-1111-111111111111', 'owner-invite@example.com', 'owner', now() + interval '1 day');

-- @case N16-b
-- @expect 23505
-- @desc 同一组织同一邮箱两条邀请，撞 invite_email_unique
insert into invite (organization_id, email, expires_at)
values ('11111111-1111-1111-1111-111111111111', 'dup@example.com', now() + interval '1 day');
insert into invite (organization_id, email, expires_at)
values ('11111111-1111-1111-1111-111111111111', 'dup@example.com', now() + interval '2 days');

-- @case N11-a
-- @expect 23514
-- @desc 非法 date_sort 格式
insert into event (organization_id, project_id, kind, person_id, date_text, date_sort)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'other', '55555555-5555-5555-5555-555555555555', '某年', 'abcd');

-- @case N11-b
-- @expect 23514
-- @desc 有 date_sort 但无 date_text，撞 event_sort_needs_text
insert into event (organization_id, project_id, kind, person_id, date_sort)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'other', '55555555-5555-5555-5555-555555555555', '2020');

-- @case N3
-- @expect 23514
-- @desc event 同时设置 person_id 与 family_id，撞 event_one_subject
insert into event (organization_id, project_id, kind, person_id, family_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'other', '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666');

-- @case N21
-- @expect 23514
-- @desc kind='birth' 只设 family_id，撞 event_person_kinds
insert into event (organization_id, project_id, kind, family_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'birth', '66666666-6666-6666-6666-666666666666');

-- @case N10
-- @expect 23505
-- @desc 同一 person 两条 birth 事件，撞 event_one_birth
insert into event (organization_id, project_id, kind, person_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'birth', '55555555-5555-5555-5555-555555555555');
insert into event (organization_id, project_id, kind, person_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'birth', '55555555-5555-5555-5555-555555555555');

-- @case N4
-- @expect 23514
-- @desc book_catalog 同时设置 article_id 与 lineage_id，撞 book_catalog_one_content
insert into book_catalog (organization_id, project_id, book_id, path, title, article_id, lineage_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '0001'::ltree, '目录', '88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777');

-- @case N8
-- @expect 23514
-- @desc node.path 字母段，撞 node_path_format
insert into node (organization_id, project_id, lineage_id, path, kind, person_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', 'aaaa'::ltree, 'primary', '55555555-5555-5555-5555-555555555555');

-- @case N9
-- @expect 23514
-- @desc annotation 节点带 person_id，撞 node_annotation_person
insert into node (organization_id, project_id, lineage_id, path, kind, person_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'annotation', '55555555-5555-5555-5555-555555555555');

-- @case N7
-- @expect 23505
-- @desc 同一世系重复 path，撞 node_path_unique
insert into node (organization_id, project_id, lineage_id, path, kind, person_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'primary', '55555555-5555-5555-5555-555555555555');
insert into node (organization_id, project_id, lineage_id, path, kind)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'annotation');

-- @case N15
-- @expect 23505
-- @desc 同一 person 两条 is_primary 姓名，撞 person_name_one_primary
insert into person_name (organization_id, project_id, person_id, kind, value, is_primary)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555', 'given', '甲', true);
insert into person_name (organization_id, project_id, person_id, kind, value, is_primary)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555', 'courtesy', '乙', true);

-- @case N31
-- @expect 23505
-- @desc 组织 B 复用组织 A 的 project.id，撞 project_id_global
insert into project (organization_id, id, ref, name)
values ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'verify-ref-clone', '克隆项目');

-- @case N14
-- @expect 23001
-- @desc 删除被 book_catalog 引用的 article，RESTRICT 违约是 23001 而非 23503
insert into book_catalog (organization_id, project_id, book_id, path, title, article_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '0001'::ltree, '引用谱文', '88888888-8888-8888-8888-888888888888');
delete from article where project_id = '33333333-3333-3333-3333-333333333333' and id = '88888888-8888-8888-8888-888888888888';
