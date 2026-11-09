-- S8 目标态反例夹具（T38，附录 B.2 的 N1–N31 全量）。
-- 每条用 `-- @case / @expect / @desc` 标注，由
-- scripts/verify-target-schema.mjs 在独立事务里逐条执行并比对 SQLSTATE，
-- 每条结束 ROLLBACK，互不污染。整文件不要 `psql -f`。
-- UUID 对应 tests/fixtures/target-schema-seed.sql 的固定 seed。
-- 场景编号沿用 tests/fixtures/target-schema-assertions.md 的附录 B.2；
-- 同一场景拆成多条时用 `-a/-b` 后缀。少数反例（N17-a / N23-b）用
-- `@expect OK` + DO 块断言「读到 0 行」「邀请仍为 pending」这类非错误语义；
-- N20 是结构性不可表达，显式 `@expect SKIP`。正例见 target-schema-positive.sql。

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

-- @case N1
-- @expect 42830
-- @desc 单列 REFERENCES person(id) 无对应唯一约束：person 主键是 (project_id, id)
create table s8_n1_probe (id uuid, person_id uuid references person(id));

-- @case N2
-- @expect 23503
-- @desc 子表 organization_id 属 ORG_A、project_id 却是 ORG_B 的项目，复合 scope FK 拒绝
insert into person (organization_id, project_id, id, sex)
values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'unknown');

-- @case N5
-- @expect 23505
-- @desc 同一 book 内重复装订同一 article，撞 book_catalog_article_once
insert into book_catalog (organization_id, project_id, book_id, path, title, article_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '0001'::ltree, '卷一', '88888888-8888-8888-8888-888888888888');
insert into book_catalog (organization_id, project_id, book_id, path, title, article_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '0002'::ltree, '卷二', '88888888-8888-8888-8888-888888888888');

-- @case N6
-- @expect 23505
-- @desc 同一 lineage 同一 person 两个 primary 节点，撞 node_one_primary
insert into node (organization_id, project_id, lineage_id, path, kind, person_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'primary', '55555555-5555-5555-5555-555555555555');
insert into node (organization_id, project_id, lineage_id, path, kind, person_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0001'::ltree, 'primary', '55555555-5555-5555-5555-555555555555');

-- @case N12-a
-- @expect 23503
-- @desc mother_person_id 指向别的家庭，四列 family_child_mother_fk 拒绝
insert into person (organization_id, project_id, id, sex) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'female');
insert into family (organization_id, project_id, id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
insert into family_partner (organization_id, project_id, family_id, person_id, role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'wife');
insert into family_child (organization_id, project_id, family_id, person_id, mother_person_id, mother_role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'wife');

-- @case N12-b
-- @expect 23514
-- @desc 只填 mother_person_id 不填 mother_role，撞 family_child_mother_pair
insert into family_child (organization_id, project_id, family_id, person_id, mother_person_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '55555555-5555-5555-5555-555555555555');

-- @case N13-a
-- @expect 23514
-- @desc origin_family_id = family_id，撞 family_child_origin_distinct
insert into family_child (organization_id, project_id, family_id, person_id, kind, origin_family_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'adopted', '66666666-6666-6666-6666-666666666666');

-- @case N13-b
-- @expect 23514
-- @desc 普通 biological 子女带出继来源，撞 family_child_origin_kind
insert into family (organization_id, project_id, id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
insert into family_child (organization_id, project_id, family_id, person_id, kind, origin_family_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'biological', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- @case N17-a
-- @expect OK
-- @desc 未注入 app.user_id 时 genealogy_app 读业务表返回 0 行（DO 块断言 fail-closed）
select set_config('app.user_id', '', true);
set local role genealogy_app;
do $$ begin
  if (select count(*) from person) <> 0 then
    raise exception 'N17: 未认证仍能读到业务行' using errcode = 'P0001';
  end if;
end $$;

-- @case N17-b
-- @expect 42501
-- @desc 未注入 app.user_id 时写入业务表被 RLS WITH CHECK 拒绝
select set_config('app.user_id', '', true);
set local role genealogy_app;
insert into person (organization_id, project_id, id, sex) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'unknown');

-- @case N18
-- @expect 42501
-- @desc 有 app schema USAGE 但无 EXECUTE 的角色调用 app.create_organization() 被拒
create role s8_n18_probe nologin;
grant usage on schema app to s8_n18_probe;
set local role s8_n18_probe;
select app.create_organization('N18');

-- @case N19
-- @expect 42501
-- @desc 邀请邮箱与当前账号不匹配，app.accept_invite 拒绝
insert into invite (organization_id, email, token_hash, expires_at) values
  ('11111111-1111-1111-1111-111111111111', 'someone-else@example.com', 'tok-n19', now() + interval '1 day');
select set_config('app.user_id', 'u-verify-a', true);
select app.accept_invite('tok-n19');

-- @case N22
-- @expect 23505
-- @desc 不走 upsert 直接 INSERT 重发同一邮箱邀请，撞 invite_email_unique
insert into invite (organization_id, email, token_hash, expires_at) values
  ('11111111-1111-1111-1111-111111111111', 'resend@example.com', 'tok-n22-a', now() + interval '1 day');
insert into invite (organization_id, email, expires_at) values
  ('11111111-1111-1111-1111-111111111111', 'resend@example.com', now() + interval '2 days');

-- @case N23
-- @expect 22023
-- @desc 过期邀请调用 accept_invite 报 22023（created_at 显式置过去以绕过 invite_expiry）
insert into invite (organization_id, email, token_hash, expires_at, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', 'tok-n23', now() - interval '1 hour', now() - interval '2 days');
select set_config('app.user_id', 'u-verify-a', true);
select app.accept_invite('tok-n23');

-- @case N23-b
-- @expect OK
-- @desc 过期邀请被拒后仍为 pending、未被消费（DO 块内捕获 22023 再断言副作用）
insert into invite (organization_id, email, token_hash, expires_at, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', 'tok-n23b', now() - interval '1 hour', now() - interval '2 days');
select set_config('app.user_id', 'u-verify-a', true);
do $$ begin
  begin
    perform app.accept_invite('tok-n23b');
    raise exception 'N23: 过期邀请竟然被接受' using errcode = 'P0001';
  exception when sqlstate '22023' then null;
  end;
  if (select status from invite where token_hash = 'tok-n23b') <> 'pending' then
    raise exception 'N23: 邀请状态被改写' using errcode = 'P0001';
  end if;
  if exists (select 1 from organization_member where organization_id = '11111111-1111-1111-1111-111111111111' and user_id = 'u-verify-a' and role <> 'owner') then
    raise exception 'N23: 产生了非预期成员行' using errcode = 'P0001';
  end if;
end $$;

-- @case N24-a
-- @expect 23503
-- @desc 写入 0010.0020 但库中无 0010 行，node_parent_fk 拒绝
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010.0020'::ltree, 'annotation');

-- @case N24-b
-- @expect 23001
-- @desc 只删一个中间 node 行，子行的 node_parent_fk RESTRICT 拒绝
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0001'::ltree, 'annotation');
delete from node where lineage_id = '77777777-7777-7777-7777-777777777777' and path = '0001'::ltree;

-- @case N26
-- @expect 22023
-- @desc 伪造 pg_temp.invite 后 accept_invite('pwned') 仍读 public.invite，无法跨租户提权
select set_config('app.user_id', 'u-verify-a', true);
create temp table invite (token_hash text, organization_id uuid, email text, role text);
insert into pg_temp.invite values ('pwned', '11111111-1111-1111-1111-111111111111', 'a@example.com', 'owner');
select app.accept_invite('pwned');

-- @case N27
-- @expect 23503
-- @desc 把丈夫填进 mother_person_id 配 wife，四列 FK 找不到 (family, person, role)
insert into person (organization_id, project_id, id, sex) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'male');
insert into person (organization_id, project_id, id, sex) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'female');
insert into family_partner (organization_id, project_id, family_id, person_id, role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'husband');
insert into family_partner (organization_id, project_id, family_id, person_id, role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000001', 'wife');
insert into family_child (organization_id, project_id, family_id, person_id, mother_person_id, mother_role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'wife');

-- @case N28-a
-- @expect 23514
-- @desc mother_role 写 husband 非法值，撞 family_child_mother_role 的 CHECK
insert into family_child (organization_id, project_id, family_id, person_id, mother_person_id, mother_role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '55555555-5555-5555-5555-555555555555', 'husband');

-- @case N28-b
-- @expect 23514
-- @desc 只填 mother_role 不填 mother_person_id，撞 family_child_mother_pair
insert into family_child (organization_id, project_id, family_id, person_id, mother_role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'wife');

-- @case N29
-- @expect 23505
-- @desc 单条 UPDATE 交换 0010 ↔ 0020，非延迟 node_path_unique 拒绝（须三阶段改名）
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0020'::ltree, 'annotation');
update node set path = case path when '0010'::ltree then '0020'::ltree else '0010'::ltree end
 where lineage_id = '77777777-7777-7777-7777-777777777777' and path in ('0010'::ltree, '0020'::ltree);

-- @case N30
-- @expect 42501
-- @desc 未授权角色查询业务表报 42501
create role s8_n30_probe nologin;
set local role s8_n30_probe;
select count(*) from person;

-- @case N30-b
-- @expect 42501
-- @desc 未授权角色调用 app.visible_org_array() 报 42501
create role s8_n30b_probe nologin;
grant usage on schema app to s8_n30b_probe;
set local role s8_n30b_probe;
select app.visible_org_array();

-- @case N20
-- @expect SKIP
-- @desc 节点是自己的祖先：路径模型无父指针，结构性不可表达，无法写出该状态
