-- S8 目标态正例夹具（T38，附录 B.1 的 P1–P32）。
-- 每条用 `-- @case / @expect / @desc` 标注，由 scripts/verify-target-schema.mjs
-- 在独立事务里执行后 ROLLBACK，互不污染。整文件不要 `psql -f`。
--
-- `@expect OK` 不代表「只检查没报错」：需要验证结果的 case 都在 SQL 的 DO 块里
-- 做真实断言，断言失败会 RAISE P0001，脚本据此判 FAIL。少数本身就是「应失败」
-- 语义的 P 场景（P20 / P27-a / P30-b）沿用五位 SQLSTATE 期望。
-- P21 / P22（Q1 整树 / Q3 子树的 EXPLAIN 计划形状与耗时）需要 10 万行压测集，
-- 由 scripts/verify-target-schema.mjs 的 --explain 段直接实跑，不在本夹具里占位；
-- N20 类结构性不可表达场景仍显式 SKIP，不伪装成通过。
--
-- UUID 对应 tests/fixtures/target-schema-seed.sql 的固定 seed；附录 B 里的
-- 「5 行」「0010/0020」是示例数据量与示例路径，本夹具按固定 seed 断言形状，
-- 不写死那些示例数字。

-- @case P1
-- @expect OK
-- @desc 全量 DDL 在干净库 0 ERROR 后，17 张 public 表 / ≥12 个 app.* 函数 / 17 条 RLS 策略齐备
do $$ begin
  if (select count(*) from pg_tables where schemaname = 'public') <> 17 then
    raise exception 'P1: public 表数量不符' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app') < 12 then
    raise exception 'P1: app.* 函数数量不足' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 17 then
    raise exception 'P1: RLS 策略数量不符' using errcode = 'P0001';
  end if;
end $$;

-- @case P2
-- @expect OK
-- @desc app.create_organization() 返回组织 ID 且写入 role='owner' 成员行
select set_config('app.user_id', 'u-verify-a', true);
do $$ declare v_org uuid; begin
  select app.create_organization('P2 新组织') into v_org;
  if v_org is null then
    raise exception 'P2: 未返回组织 ID' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from organization_member
     where organization_id = v_org and user_id = 'u-verify-a' and role = 'owner'
  ) then
    raise exception 'P2: owner 成员行缺失' using errcode = 'P0001';
  end if;
end $$;

-- @case P3
-- @expect OK
-- @desc 邮箱匹配时 app.accept_invite() 写入成员行并把邀请置为 accepted
insert into invite (organization_id, email, token_hash, expires_at, role) values
  ('11111111-1111-1111-1111-111111111111', 'b@example.com', 'tok-p3', now() + interval '1 day', 'editor');
select set_config('app.user_id', 'u-verify-b', true);
do $$ declare v_org uuid; begin
  select app.accept_invite('tok-p3') into v_org;
  if v_org <> '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'P3: 返回了错误的组织' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from organization_member
     where organization_id = v_org and user_id = 'u-verify-b' and role = 'editor'
  ) then
    raise exception 'P3: 成员行未写入或角色不对' using errcode = 'P0001';
  end if;
  if (select status from invite where token_hash = 'tok-p3') <> 'accepted' then
    raise exception 'P3: 邀请未被消费' using errcode = 'P0001';
  end if;
end $$;

-- @case P4
-- @expect OK
-- @desc 同一 article 被两部 book 的目录条目引用成功（article 与目录是多对一）
insert into book (organization_id, project_id, id, title) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000010', '第二部谱书');
insert into book_catalog (organization_id, project_id, book_id, path, title, article_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '0001'::ltree, '卷一', '88888888-8888-8888-8888-888888888888');
insert into book_catalog (organization_id, project_id, book_id, path, title, article_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000010', '0001'::ltree, '卷一', '88888888-8888-8888-8888-888888888888');
do $$ begin
  if (select count(*) from book_catalog where article_id = '88888888-8888-8888-8888-888888888888') <> 2 then
    raise exception 'P4: 同一谱文未能被两部谱书引用' using errcode = 'P0001';
  end if;
end $$;

-- @case P5
-- @expect OK
-- @desc 同一 lineage 被两部 book 的目录条目引用成功
insert into book (organization_id, project_id, id, title) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000011', '第三部谱书');
insert into book_catalog (organization_id, project_id, book_id, path, title, lineage_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '0001'::ltree, '世系', '77777777-7777-7777-7777-777777777777');
insert into book_catalog (organization_id, project_id, book_id, path, title, lineage_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000011', '0001'::ltree, '世系', '77777777-7777-7777-7777-777777777777');
do $$ begin
  if (select count(*) from book_catalog where lineage_id = '77777777-7777-7777-7777-777777777777') <> 2 then
    raise exception 'P5: 同一谱系未能被两部谱书引用' using errcode = 'P0001';
  end if;
end $$;

-- @case P6
-- @expect OK
-- @desc 同一 person 在同一 lineage 有一个 primary 与两个 repeat 节点，路径各不相同且闭合
insert into node (organization_id, project_id, lineage_id, path, kind, person_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'primary', '55555555-5555-5555-5555-555555555555');
insert into node (organization_id, project_id, lineage_id, path, kind, person_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0001'::ltree, 'repeat', '55555555-5555-5555-5555-555555555555');
insert into node (organization_id, project_id, lineage_id, path, kind, person_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0002'::ltree, 'repeat', '55555555-5555-5555-5555-555555555555');
do $$ begin
  if (select count(*) from node where person_id = '55555555-5555-5555-5555-555555555555' and kind = 'primary') <> 1 then
    raise exception 'P6: primary 节点数不对' using errcode = 'P0001';
  end if;
  if (select count(*) from node where person_id = '55555555-5555-5555-5555-555555555555' and kind = 'repeat') <> 2 then
    raise exception 'P6: repeat 节点数不对' using errcode = 'P0001';
  end if;
end $$;

-- @case P7
-- @expect OK
-- @desc 旁注节点 kind='annotation' 且 person_id IS NULL 可插入
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'annotation');
do $$ begin
  if not exists (select 1 from node where kind = 'annotation' and person_id is null) then
    raise exception 'P7: 旁注节点未落库' using errcode = 'P0001';
  end if;
end $$;

-- @case P8
-- @expect OK
-- @desc 同一 person 作为 family_child 出现在生父与养父两个 family；母亲四列 FK 指向同家庭伴侣
insert into person (organization_id, project_id, id, sex) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000020', 'female');
insert into person (organization_id, project_id, id, sex) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000021', 'male');
insert into family (organization_id, project_id, id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000022');
insert into family_partner (organization_id, project_id, family_id, person_id, role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000020', 'wife');
insert into family_partner (organization_id, project_id, family_id, person_id, role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000020', 'wife');
insert into family_child (organization_id, project_id, family_id, person_id, kind, mother_person_id, mother_role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000021', 'biological', '00000000-0000-0000-0000-000000000020', 'wife');
insert into family_child (organization_id, project_id, family_id, person_id, kind, mother_person_id, mother_role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000021', 'adopted', '00000000-0000-0000-0000-000000000020', 'wife');
do $$ begin
  if (select count(*) from family_child where person_id = '00000000-0000-0000-0000-000000000021') <> 2 then
    raise exception 'P8: 同一人在两个家庭的子女行未同时存在' using errcode = 'P0001';
  end if;
end $$;

-- @case P9
-- @expect OK
-- @desc origin_family_id 指向另一家庭且 kind='ritual_heir' 可插入
insert into family (organization_id, project_id, id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000023');
insert into family_child (organization_id, project_id, family_id, person_id, kind, origin_family_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'ritual_heir', '00000000-0000-0000-0000-000000000023');
do $$ begin
  if not exists (select 1 from family_child where kind = 'ritual_heir' and origin_family_id is not null) then
    raise exception 'P9: 出继来源子女行未落库' using errcode = 'P0001';
  end if;
end $$;

-- @case P10
-- @expect OK
-- @desc 整棵世系 ORDER BY path 给出深度优先顺序，祖先在后代之前；base_generation + nlevel - 1 给出世次
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0001'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0001.0001'::ltree, 'annotation');
do $$ declare v_order text; v_gen int; begin
  select string_agg(path::text, ',' order by path) into v_order
    from node where lineage_id = '77777777-7777-7777-7777-777777777777';
  if v_order <> '0001,0001.0001,0001.0001.0001' then
    raise exception 'P10: ORDER BY path 顺序不对，得到 %', v_order using errcode = 'P0001';
  end if;
  select l.base_generation + nlevel(n.path) - 1 into v_gen
    from lineage l join node n on n.project_id = l.project_id and n.lineage_id = l.id
   where n.path = '0001.0001.0001'::ltree;
  if v_gen <> 3 then
    raise exception 'P10: 世次计算不对，得到 %', v_gen using errcode = 'P0001';
  end if;
end $$;

-- @case P11
-- @expect OK
-- @desc 整书目录 ORDER BY path 直接得到深度优先顺序，无需递归 CTE
insert into book_catalog (organization_id, project_id, book_id, path, title) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '0001'::ltree, '卷一');
insert into book_catalog (organization_id, project_id, book_id, path, title) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '0001.0001'::ltree, '卷一之一');
insert into book_catalog (organization_id, project_id, book_id, path, title) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', '0002'::ltree, '卷二');
do $$ declare v_order text; begin
  select string_agg(path::text, ',' order by path) into v_order
    from book_catalog where book_id = '99999999-9999-9999-9999-999999999999';
  if v_order <> '0001,0001.0001,0002' then
    raise exception 'P11: 目录顺序不对，得到 %', v_order using errcode = 'P0001';
  end if;
end $$;

-- @case P12
-- @expect OK
-- @desc 同级中间插入 0010.0015，只新增 1 行、不重排既有兄弟
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010.0010'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010.0020'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010.0015'::ltree, 'annotation');
do $$ declare v_order text; begin
  select string_agg(path::text, ',' order by path) into v_order
    from node where lineage_id = '77777777-7777-7777-7777-777777777777';
  if v_order <> '0010,0010.0010,0010.0015,0010.0020' then
    raise exception 'P12: 中间插入后顺序不对，得到 %', v_order using errcode = 'P0001';
  end if;
end $$;

-- @case P13
-- @expect OK
-- @desc 一条 UPDATE 把整棵子树移到空闲目标槽，parent_path 生成列自动联动
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0001'::ltree, 'annotation');
update node set path = ('0030' || substring(path::text from 5))::ltree
 where lineage_id = '77777777-7777-7777-7777-777777777777' and path <@ '0001'::ltree;
do $$ begin
  if (select count(*) from node where path <@ '0030'::ltree) <> 2 then
    raise exception 'P13: 子树未整体迁移' using errcode = 'P0001';
  end if;
  if (select parent_path from node where path = '0030.0001'::ltree) <> '0030'::ltree then
    raise exception 'P13: parent_path 未自动联动' using errcode = 'P0001';
  end if;
end $$;

-- @case P14
-- @expect OK
-- @desc 一条 DELETE 含根删整棵子树（node_parent_fk RESTRICT 在同语句内不误伤）
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0001'::ltree, 'annotation');
delete from node where lineage_id = '77777777-7777-7777-7777-777777777777' and path <@ '0001'::ltree;
do $$ begin
  if (select count(*) from node where lineage_id = '77777777-7777-7777-7777-777777777777') <> 0 then
    raise exception 'P14: 整棵子树未删除干净' using errcode = 'P0001';
  end if;
end $$;

-- @case P15
-- @expect OK
-- @desc 删除 folder 后 lineage / article / book 三个内容根 folder_id 置 NULL，project_id 保持非空
insert into folder (organization_id, project_id, id, name) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000030', '验收目录');
update lineage set folder_id = '00000000-0000-0000-0000-000000000030' where id = '77777777-7777-7777-7777-777777777777';
update article set folder_id = '00000000-0000-0000-0000-000000000030' where id = '88888888-8888-8888-8888-888888888888';
update book set folder_id = '00000000-0000-0000-0000-000000000030' where id = '99999999-9999-9999-9999-999999999999';
delete from folder where project_id = '33333333-3333-3333-3333-333333333333' and id = '00000000-0000-0000-0000-000000000030';
do $$ begin
  if exists (
    select 1 from (
      select folder_id, project_id from lineage where id = '77777777-7777-7777-7777-777777777777'
      union all select folder_id, project_id from article where id = '88888888-8888-8888-8888-888888888888'
      union all select folder_id, project_id from book where id = '99999999-9999-9999-9999-999999999999'
    ) x where folder_id is not null or project_id is null
  ) then
    raise exception 'P15: ON DELETE SET NULL (folder_id) 未生效' using errcode = 'P0001';
  end if;
end $$;

-- @case P16
-- @expect OK
-- @desc 组织 A 的会话查不到组织 B 的任何一行，但能看到本组织的 person
select set_config('app.user_id', 'u-verify-a', true);
set local role genealogy_app;
do $$ begin
  if (select count(*) from organization where id = '22222222-2222-2222-2222-222222222222') <> 0 then
    raise exception 'P16: 能看见组织 B' using errcode = 'P0001';
  end if;
  if (select count(*) from project where organization_id = '22222222-2222-2222-2222-222222222222') <> 0 then
    raise exception 'P16: 能看见组织 B 的项目' using errcode = 'P0001';
  end if;
  if (select count(*) from person where organization_id = '11111111-1111-1111-1111-111111111111') < 1 then
    raise exception 'P16: 看不到本组织的数据' using errcode = 'P0001';
  end if;
end $$;

-- @case P17
-- @expect OK
-- @desc 嫡庶查询一次 join 返回 mother_id / rank / role_label，join 带 AND fp.role = fc.mother_role
insert into person (organization_id, project_id, id, sex) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000040', 'female');
insert into family_partner (organization_id, project_id, family_id, person_id, role, role_label, rank) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000040', 'wife', '元配', 1);
insert into family_child (organization_id, project_id, family_id, person_id, mother_person_id, mother_role) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000040', 'wife');
do $$ declare r record; begin
  select fp.person_id as mother_id, fp.rank, fp.role_label into r
    from family_child fc
    join family_partner fp
      on fp.project_id = fc.project_id
     and fp.family_id = fc.family_id
     and fp.person_id = fc.mother_person_id
     and fp.role = fc.mother_role
   where fc.project_id = '33333333-3333-3333-3333-333333333333'::uuid;
  if r.mother_id is null or r.rank <> 1 or r.role_label <> '元配' then
    raise exception 'P17: 嫡庶 join 未返回正确的母亲 / 位次 / 称谓' using errcode = 'P0001';
  end if;
end $$;

-- @case P18
-- @expect OK
-- @desc 人物生卒用两次 LEFT JOIN，每人各最多一行（部分唯一索引 event_one_birth / event_one_death）
insert into event (organization_id, project_id, kind, person_id, date_text) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'birth', '55555555-5555-5555-5555-555555555555', '1900');
insert into event (organization_id, project_id, kind, person_id, date_text) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'death', '55555555-5555-5555-5555-555555555555', '1980');
do $$ declare n_rows int; n_people int; begin
  select count(*) into n_rows from (
    select p.id, b.id as birth_id, d.id as death_id
      from person p
      left join event b on b.project_id = p.project_id and b.person_id = p.id and b.kind = 'birth'
      left join event d on d.project_id = p.project_id and d.person_id = p.id and d.kind = 'death'
     where p.project_id = '33333333-3333-3333-3333-333333333333'::uuid
  ) x;
  select count(*) into n_people from person where project_id = '33333333-3333-3333-3333-333333333333'::uuid;
  if n_rows <> n_people then
    raise exception 'P18: 两次 LEFT JOIN 产生了重复行（% vs %）', n_rows, n_people using errcode = 'P0001';
  end if;
end $$;

-- @case P19
-- @expect OK
-- @desc 过期邀请重发：带 WHERE accepted_at IS NULL 的 upsert 成功，同一邮箱仍一行、status 回 pending、新 token 生效
insert into invite (organization_id, email, token_hash, expires_at, created_at, status) values
  ('11111111-1111-1111-1111-111111111111', 'p19@example.com', 'tok-p19-old', now() - interval '1 hour', now() - interval '2 days', 'revoked');
insert into invite (organization_id, email, token_hash, expires_at, status) values
  ('11111111-1111-1111-1111-111111111111', 'p19@example.com', 'tok-p19-new', now() + interval '30 days', 'pending')
  on conflict (organization_id, email) do update
    set status = excluded.status, token_hash = excluded.token_hash,
        expires_at = excluded.expires_at, accepted_at = null
  where invite.accepted_at is null;
do $$ begin
  if (select count(*) from invite where email = 'p19@example.com') <> 1 then
    raise exception 'P19: 重发产生了多行' using errcode = 'P0001';
  end if;
  if (select status from invite where email = 'p19@example.com') <> 'pending' then
    raise exception 'P19: status 未回到 pending' using errcode = 'P0001';
  end if;
  if (select token_hash from invite where email = 'p19@example.com') <> 'tok-p19-new' then
    raise exception 'P19: 新 token_hash 未生效' using errcode = 'P0001';
  end if;
end $$;

-- @case P20
-- @expect OK
-- @desc 已是 viewer 的账号接受 editor 邀请报 23505，邀请仍 pending、成员角色不变（DO 块内捕获并断言）
insert into auth.user (id, email, name) values ('u-p20', 'p20@example.com', 'P20');
insert into organization_member (organization_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'u-p20', 'viewer');
insert into invite (organization_id, email, token_hash, expires_at, role) values
  ('11111111-1111-1111-1111-111111111111', 'p20@example.com', 'tok-p20', now() + interval '1 day', 'editor');
select set_config('app.user_id', 'u-p20', true);
do $$ begin
  begin
    perform app.accept_invite('tok-p20');
    raise exception 'P20: 已是成员竟然接受成功' using errcode = 'P0001';
  exception when sqlstate '23505' then null;
  end;
  if (select status from invite where token_hash = 'tok-p20') <> 'pending' then
    raise exception 'P20: 邀请被消费' using errcode = 'P0001';
  end if;
  if (select role from organization_member where organization_id = '11111111-1111-1111-1111-111111111111' and user_id = 'u-p20') <> 'viewer' then
    raise exception 'P20: 成员角色被改写' using errcode = 'P0001';
  end if;
end $$;

-- P21 / P22 见 scripts/verify-target-schema.mjs 的 verifyExplain()：
-- 建 10 万行压测集后以 genealogy_app 实跑 Q1（整树）/ Q3（子树），
-- 断言 InitPlan、计划形状与 < 100ms；SQL 夹具里没有对应的静态 case。

-- @case P23
-- @expect OK
-- @desc 路径闭合树上孤儿检测 SQL 返回 0 行，且由 node_parent_fk 结构性保证
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0001'::ltree, 'annotation');
do $$ begin
  if exists (
    select 1 from node c
     where c.parent_path is not null
       and not exists (
         select 1 from node p
          where p.project_id = c.project_id
            and p.lineage_id = c.lineage_id
            and p.path = c.parent_path
       )
  ) then
    raise exception 'P23: 存在孤儿节点' using errcode = 'P0001';
  end if;
end $$;

-- @case P24
-- @expect OK
-- @desc event.kind='adoption' 分别挂 person_id 与 family_id 都能写入
insert into event (organization_id, project_id, kind, person_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'adoption', '55555555-5555-5555-5555-555555555555');
insert into event (organization_id, project_id, kind, family_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'adoption', '66666666-6666-6666-6666-666666666666');
do $$ begin
  if (select count(*) from event where kind = 'adoption' and person_id is not null) <> 1 then
    raise exception 'P24: 人物侧 adoption 未落库' using errcode = 'P0001';
  end if;
  if (select count(*) from event where kind = 'adoption' and family_id is not null) <> 1 then
    raise exception 'P24: 家庭侧 adoption 未落库' using errcode = 'P0001';
  end if;
end $$;

-- @case P25
-- @expect OK
-- @desc genealogy_app 执行 SELECT count(*) FROM person 成功（A.6 表级 DML GRANT 生效）
select set_config('app.user_id', 'u-verify-a', true);
set local role genealogy_app;
do $$ begin
  if (select count(*) from person) < 1 then
    raise exception 'P25: 表级 DML GRANT 未生效或 RLS 全部过滤' using errcode = 'P0001';
  end if;
end $$;

-- @case P26
-- @expect OK
-- @desc 伪造 pg_temp.organization_member / invite 后 visible_org_array 仍返回真实集合，accept_invite('pwned') 报 22023 且无跨租户成员行
select set_config('app.user_id', 'u-verify-a', true);
create temp table organization_member (organization_id uuid, user_id text, role text);
insert into pg_temp.organization_member values ('22222222-2222-2222-2222-222222222222', 'u-verify-a', 'owner');
create temp table invite (token_hash text, organization_id uuid, email text, role text);
insert into pg_temp.invite values ('pwned', '11111111-1111-1111-1111-111111111111', 'a@example.com', 'owner');
do $$ declare v_orgs uuid[]; v_before int; v_after int; begin
  v_orgs := app.visible_org_array();
  if not ('11111111-1111-1111-1111-111111111111'::uuid = any(v_orgs)) then
    raise exception 'P26: 真实组织不在可见集合里' using errcode = 'P0001';
  end if;
  if '22222222-2222-2222-2222-222222222222'::uuid = any(v_orgs) then
    raise exception 'P26: 伪造的跨租户组织泄漏进可见集合' using errcode = 'P0001';
  end if;
  select count(*) into v_before from public.organization_member;
  begin
    perform app.accept_invite('pwned');
    raise exception 'P26: 伪造邀请被接受' using errcode = 'P0001';
  exception when sqlstate '22023' then null;
  end;
  select count(*) into v_after from public.organization_member;
  if v_before <> v_after then
    raise exception 'P26: 产生了跨租户成员行' using errcode = 'P0001';
  end if;
end $$;

-- @case P27-a
-- @expect 23503
-- @desc 插入无父子路径被 node_parent_fk 拒绝（N24-a 同形状，此处作为 P27 的首段）
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010.0020'::ltree, 'annotation');

-- @case P27-b
-- @expect OK
-- @desc 闭合树上 parent_path 由生成列正确派生，不可手写
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010.0020'::ltree, 'annotation');
do $$ begin
  if (select parent_path from node where path = '0010'::ltree) is not null then
    raise exception 'P27: 根节点 parent_path 应为 NULL' using errcode = 'P0001';
  end if;
  if (select parent_path from node where path = '0010.0020'::ltree) <> '0010'::ltree then
    raise exception 'P27: 子节点 parent_path 派生错误' using errcode = 'P0001';
  end if;
end $$;

-- @case P27-c
-- @expect OK
-- @desc 单条 UPDATE 安全移树后子节点的父路径自动联动（生成列随 path 重算）
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001'::ltree, 'annotation');
insert into node (organization_id, project_id, lineage_id, path, kind) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0001.0001'::ltree, 'annotation');
update node set path = ('0040' || substring(path::text from 5))::ltree
 where lineage_id = '77777777-7777-7777-7777-777777777777' and path <@ '0001'::ltree;
do $$ begin
  if (select parent_path from node where path = '0040.0001'::ltree) <> '0040'::ltree then
    raise exception 'P27: 移树后 parent_path 未联动' using errcode = 'P0001';
  end if;
end $$;

-- @case P28
-- @expect OK
-- @desc 三阶段改名把两棵根段连同子树整体交换，终态路径闭合且组标记随子树移动
insert into node (organization_id, project_id, lineage_id, path, kind, display_name) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010'::ltree, 'annotation', 'A');
insert into node (organization_id, project_id, lineage_id, path, kind, display_name) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0010.0010'::ltree, 'annotation', 'A1');
insert into node (organization_id, project_id, lineage_id, path, kind, display_name) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0020'::ltree, 'annotation', 'B');
insert into node (organization_id, project_id, lineage_id, path, kind, display_name) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', '0020.0010'::ltree, 'annotation', 'B1');
update node set path = ('9999' || substring(path::text from 5))::ltree
 where lineage_id = '77777777-7777-7777-7777-777777777777' and path <@ '0010'::ltree;
update node set path = ('0010' || substring(path::text from 5))::ltree
 where lineage_id = '77777777-7777-7777-7777-777777777777' and path <@ '0020'::ltree;
update node set path = ('0020' || substring(path::text from 5))::ltree
 where lineage_id = '77777777-7777-7777-7777-777777777777' and path <@ '9999'::ltree;
do $$ begin
  if (select count(*) from node where lineage_id = '77777777-7777-7777-7777-777777777777') <> 4 then
    raise exception 'P28: 三阶段改名后行数不对' using errcode = 'P0001';
  end if;
  if exists (select 1 from node where path <@ '9999'::ltree) then
    raise exception 'P28: 临时段未完全消掉' using errcode = 'P0001';
  end if;
  if (select display_name from node where path = '0020'::ltree) <> 'A' then
    raise exception 'P28: 原 0010 组未换到 0020' using errcode = 'P0001';
  end if;
  if (select display_name from node where path = '0010'::ltree) <> 'B' then
    raise exception 'P28: 原 0020 组未换到 0010' using errcode = 'P0001';
  end if;
  if (select display_name from node where path = '0020.0010'::ltree) <> 'A1' then
    raise exception 'P28: 子树没有跟随根段移动' using errcode = 'P0001';
  end if;
end $$;

-- @case P29
-- @expect OK
-- @desc SET LOCAL ROLE genealogy_app + SET LOCAL app.user_id 同一事务内 GUC 生效（按固定 seed 断言可见行数，不写死附录示例的 5 行）
set local role genealogy_app;
select set_config('app.user_id', 'u-verify-a', true);
do $$ declare n int; begin
  select count(*) into n from person;
  if n < 1 then
    raise exception 'P29: 同事务 GUC 未生效，业务表 0 行' using errcode = 'P0001';
  end if;
  if current_setting('app.user_id', true) <> 'u-verify-a' then
    raise exception 'P29: current_setting 读不到注入值' using errcode = 'P0001';
  end if;
end $$;

-- @case P30
-- @expect OK
-- @desc book_export 登记一行 (book_id, fact_cutoff, artifact_uri, checksum, format) 成功
insert into book_export (organization_id, project_id, book_id, fact_cutoff, artifact_uri, checksum, format) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', now() - interval '1 day', 's3://verify/book.pdf', repeat('a', 64), 'pdf');
do $$ begin
  if (select count(*) from book_export where book_id = '99999999-9999-9999-9999-999999999999') <> 1 then
    raise exception 'P30: 导出物元数据未落库' using errcode = 'P0001';
  end if;
end $$;

-- @case P30-b
-- @expect 23514
-- @desc fact_cutoff > exported_at 被 book_export_cutoff CHECK 拒绝
insert into book_export (organization_id, project_id, book_id, fact_cutoff, artifact_uri, checksum) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', now() + interval '1 day', 's3://verify/future.pdf', repeat('b', 64));

-- @case P31
-- @expect OK
-- @desc project.id 全局唯一：两个组织各自用不同 id 建项目成功（复用同一 id 由 N31 断言 23505）
insert into project (organization_id, id, ref, name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000050', 'p31-a', 'P31 A');
insert into project (organization_id, id, ref, name) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000051', 'p31-b', 'P31 B');
do $$ begin
  if (select count(*) from project where id in ('00000000-0000-0000-0000-000000000050'::uuid, '00000000-0000-0000-0000-000000000051'::uuid)) <> 2 then
    raise exception 'P31: 两个组织各自建项目失败' using errcode = 'P0001';
  end if;
end $$;

-- @case P32
-- @expect OK
-- @desc status='revoked' 且 accepted_at 非空的行，带 WHERE accepted_at IS NULL 的重发 upsert 影响 0 行、accepted_at 保留
insert into invite (organization_id, email, token_hash, expires_at, status, accepted_at) values
  ('11111111-1111-1111-1111-111111111111', 'p32@example.com', 'tok-p32', now() + interval '30 days', 'revoked', now() - interval '1 day');
insert into invite (organization_id, email, token_hash, expires_at, status) values
  ('11111111-1111-1111-1111-111111111111', 'p32@example.com', 'tok-p32-new', now() + interval '60 days', 'pending')
  on conflict (organization_id, email) do update
    set status = excluded.status, token_hash = excluded.token_hash,
        expires_at = excluded.expires_at, accepted_at = null
  where invite.accepted_at is null;
do $$ begin
  if (select token_hash from invite where email = 'p32@example.com') <> 'tok-p32' then
    raise exception 'P32: 已接受的邀请被重发改写' using errcode = 'P0001';
  end if;
  if (select status from invite where email = 'p32@example.com') <> 'revoked' then
    raise exception 'P32: status 被改写' using errcode = 'P0001';
  end if;
  if (select accepted_at from invite where email = 'p32@example.com') is null then
    raise exception 'P32: accepted_at 被清空' using errcode = 'P0001';
  end if;
end $$;

-- @case P32-b
-- @expect OK
-- @desc pending 与无 accepted_at 的 revoked 仍可重发
insert into invite (organization_id, email, token_hash, expires_at, status) values
  ('11111111-1111-1111-1111-111111111111', 'p32b@example.com', 'tok-p32b-old', now() + interval '1 day', 'revoked');
insert into invite (organization_id, email, token_hash, expires_at, status) values
  ('11111111-1111-1111-1111-111111111111', 'p32b@example.com', 'tok-p32b-new', now() + interval '30 days', 'pending')
  on conflict (organization_id, email) do update
    set status = excluded.status, token_hash = excluded.token_hash,
        expires_at = excluded.expires_at, accepted_at = null
  where invite.accepted_at is null;
do $$ begin
  if (select token_hash from invite where email = 'p32b@example.com') <> 'tok-p32b-new' then
    raise exception 'P32: 无时刻的 revoked 未能重发' using errcode = 'P0001';
  end if;
  if (select status from invite where email = 'p32b@example.com') <> 'pending' then
    raise exception 'P32: 重发后 status 未回 pending' using errcode = 'P0001';
  end if;
end $$;
