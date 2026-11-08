-- S8 目标数据模型 · 唯一迁移基线（G0 ① 整体重建）
-- 真相源：附录 A 全量 DDL 归档（gramps-S8-目标DDL.sql），按 A.0→A.6 顺序拼接。
-- 跳过 A.7：该块是参数化的重发邀请写入样例，由应用服务执行，不属于 DDL。
-- 本文件只含建表与隔离策略，不含任何结构性的过渡 DDL；
--   A.6 中开启行级安全所需的 ALTER 语句是目标态本身，不是过渡。
-- 执行：psql -v ON_ERROR_STOP=1 -f lib/db/migrations/0000_target_schema.sql
-- G0 ① 切换时须连带清空目标库 drizzle.__drizzle_migrations 记录表（见 T52）。
-- 本基线为 DDL 唯一落点；schema TS 由 T18–T28 追平，T39 验收零漂移。
-- 注意：A.0 的角色创建沿用附录 A 原文的示例口令，生产切换前按 T34 / G1
--   由部署环境注入真实凭据，勿带示例值上线。

-- ===== [A.0] 部署前置 =====

-- 以超级用户 / 迁移角色执行一次
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genealogy_app') THEN
    CREATE ROLE genealogy_app LOGIN PASSWORD 'app_pw';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.user (
  id         text PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  name       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 若 auth.* 由别的角色拥有（生产环境由 Better Auth 建表），需由该属主执行：
--   GRANT USAGE, CREATE ON SCHEMA auth TO <ddl_role>;
--   GRANT SELECT, REFERENCES ON auth.user TO <ddl_role>;
-- 注意：CREATE TABLE IF NOT EXISTS 也要求 CREATE ON SCHEMA，仅 USAGE 不够（42501）。
-- app.accept_invite 的函数属主另需 USAGE ON SCHEMA auth + SELECT ON auth.user，
-- 否则 SECDEF 内读 auth.user.email 报 42501（permission denied for table user）。
-- 以 postgres 为属主时天然具备，以上授权可跳过。

-- ===== [A.1] 扩展与域类型 =====

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- uuid 的 GiST opclass
CREATE SCHEMA IF NOT EXISTS app;

CREATE DOMAIN member_role_t AS text
  CHECK (VALUE IN ('owner','admin','editor','viewer'));

-- ===== [A.2] 边界层 =====

CREATE TABLE organization (
  id          uuid NOT NULL DEFAULT uuidv7(),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  created_by  text REFERENCES auth.user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE organization_member (
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  user_id         text NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  role            member_role_t NOT NULL DEFAULT 'viewer',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX organization_member_user_idx ON organization_member (user_id, organization_id);

CREATE TABLE invite (
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  id              uuid NOT NULL DEFAULT uuidv7(),
  email           text NOT NULL
                  CHECK (email = lower(email)
                         AND btrim(email) <> ''
                         AND position('@' IN email) > 1),
  role            member_role_t NOT NULL DEFAULT 'viewer' CHECK (role <> 'owner'),
  token_hash      text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','revoked')),
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  invited_by      text REFERENCES auth.user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  CONSTRAINT invite_email_unique UNIQUE (organization_id, email),
  CONSTRAINT invite_expiry   CHECK (expires_at > created_at),
  -- 两条单向蕴含：允许 revoked 保留 accepted_at
  CONSTRAINT invite_accepted_needs_time
    CHECK (status <> 'accepted' OR accepted_at IS NOT NULL),
  CONSTRAINT invite_accept_time_needs_state
    CHECK (accepted_at IS NULL OR status IN ('accepted','revoked'))
);
CREATE INDEX invite_status_idx ON invite (organization_id, status);

CREATE TABLE project (
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  id              uuid NOT NULL DEFAULT uuidv7(),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  description     text,
  created_by      text REFERENCES auth.user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  -- 全局唯一：两个组织不能拥有同 id 的项目，否则项目内复合 FK 可跨组织引用（§4.1）
  CONSTRAINT project_id_global UNIQUE (id)
);
CREATE INDEX project_created_idx ON project (organization_id, created_at);

CREATE TABLE folder (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  seq             integer NOT NULL DEFAULT 0 CHECK (seq >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT folder_name_unique UNIQUE (project_id, name),
  CONSTRAINT folder_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX folder_order_idx ON folder (project_id, seq);

-- ===== [A.3] 事实层 =====

CREATE TABLE person (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  sex             text NOT NULL DEFAULT 'unknown'
                  CHECK (sex IN ('male','female','other','unknown')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT person_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE person_name (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  person_id       uuid NOT NULL,
  kind            text NOT NULL DEFAULT 'given'
                  CHECK (kind IN ('given','courtesy','art','milk','genealogy','posthumous','other')),
  value           text NOT NULL CHECK (btrim(value) <> ''),
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT person_name_unique UNIQUE (project_id, person_id, kind, value),
  CONSTRAINT person_name_person_fk FOREIGN KEY (project_id, person_id)
    REFERENCES person (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT person_name_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX person_name_person_idx ON person_name (project_id, person_id, kind);
CREATE UNIQUE INDEX person_name_one_primary
  ON person_name (project_id, person_id) WHERE is_primary;

CREATE TABLE family (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT family_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE family_partner (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  family_id       uuid NOT NULL,
  person_id       uuid NOT NULL,
  role            text NOT NULL DEFAULT 'partner'
                  CHECK (role IN ('husband','wife','concubine','partner','unknown')),
  role_label      text,
  rank            smallint CHECK (rank > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT family_partner_unique UNIQUE (project_id, family_id, person_id),
  -- 四列母亲 FK 的引用目标
  CONSTRAINT family_partner_role_unique UNIQUE (project_id, family_id, person_id, role),
  -- 按角色分域：丈夫与元配可各自 rank=1
  CONSTRAINT family_partner_rank_unique UNIQUE (project_id, family_id, role, rank),
  CONSTRAINT family_partner_family_fk FOREIGN KEY (project_id, family_id)
    REFERENCES family (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT family_partner_person_fk FOREIGN KEY (project_id, person_id)
    REFERENCES person (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT family_partner_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX family_partner_person_idx ON family_partner (project_id, person_id);

CREATE TABLE family_child (
  organization_id   uuid NOT NULL,
  project_id        uuid NOT NULL,
  id                uuid NOT NULL DEFAULT uuidv7(),
  family_id         uuid NOT NULL,
  person_id         uuid NOT NULL,
  kind              text NOT NULL DEFAULT 'biological'
                    CHECK (kind IN ('biological','adopted','step','foster','ritual_heir','unknown')),
  mother_person_id  uuid,
  mother_role       text CHECK (mother_role IN ('wife','concubine')),
  origin_family_id  uuid,
  birth_order       integer CHECK (birth_order > 0),
  birth_order_label text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT family_child_unique UNIQUE (project_id, family_id, person_id),
  -- MATCH SIMPLE 遇任一列 NULL 会跳过整条 FK，必须强制成对
  CONSTRAINT family_child_mother_pair
    CHECK ((mother_person_id IS NULL) = (mother_role IS NULL)),
  CONSTRAINT family_child_origin_distinct
    CHECK (origin_family_id IS NULL OR origin_family_id <> family_id),
  CONSTRAINT family_child_origin_kind
    CHECK (origin_family_id IS NULL OR kind IN ('adopted','ritual_heir')),
  CONSTRAINT family_child_family_fk FOREIGN KEY (project_id, family_id)
    REFERENCES family (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT family_child_person_fk FOREIGN KEY (project_id, person_id)
    REFERENCES person (project_id, id) ON DELETE RESTRICT,
  -- 四列 FK：母亲必须同时匹配 person 与 role
  CONSTRAINT family_child_mother_fk
    FOREIGN KEY (project_id, family_id, mother_person_id, mother_role)
    REFERENCES family_partner (project_id, family_id, person_id, role) ON DELETE RESTRICT,
  CONSTRAINT family_child_origin_fk FOREIGN KEY (project_id, origin_family_id)
    REFERENCES family (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT family_child_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX family_child_person_idx ON family_child (project_id, person_id);

CREATE TABLE event (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  kind            text NOT NULL
                  CHECK (kind IN ('birth','death','burial','marriage','divorce',
                                  'adoption','heir_transfer','migration','office','exam','other')),
  person_id       uuid,
  family_id       uuid,
  date_text       text,
  date_sort       text CHECK (date_sort ~ '^[0-9]{4}(-[0-9]{2})?(-[0-9]{2})?$'),
  place_text      text,
  summary         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT event_one_subject CHECK (num_nonnulls(person_id, family_id) = 1),
  CONSTRAINT event_person_kinds
    CHECK (kind NOT IN ('birth','death','burial','migration','office','exam')
           OR person_id IS NOT NULL),
  CONSTRAINT event_family_kinds
    CHECK (kind NOT IN ('marriage','divorce') OR family_id IS NOT NULL),
  CONSTRAINT event_sort_needs_text CHECK (date_sort IS NULL OR date_text IS NOT NULL),
  CONSTRAINT event_person_fk FOREIGN KEY (project_id, person_id)
    REFERENCES person (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT event_family_fk FOREIGN KEY (project_id, family_id)
    REFERENCES family (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT event_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX event_person_date_idx ON event (project_id, person_id, date_sort);
CREATE INDEX event_family_date_idx ON event (project_id, family_id, date_sort);
CREATE UNIQUE INDEX event_one_birth ON event (project_id, person_id) WHERE kind = 'birth';
CREATE UNIQUE INDEX event_one_death ON event (project_id, person_id) WHERE kind = 'death';

-- ===== [A.4] 谱系层 =====

CREATE TABLE lineage (
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  id               uuid NOT NULL DEFAULT uuidv7(),
  folder_id        uuid,
  name             text NOT NULL CHECK (btrim(name) <> ''),
  description      text,
  poem_text        text,
  base_generation  integer NOT NULL DEFAULT 1 CHECK (base_generation > 0),
  seq              integer NOT NULL DEFAULT 0 CHECK (seq >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT lineage_name_unique UNIQUE (project_id, name),
  CONSTRAINT lineage_folder_fk FOREIGN KEY (project_id, folder_id)
    REFERENCES folder (project_id, id) ON DELETE SET NULL (folder_id),
  CONSTRAINT lineage_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX lineage_folder_idx ON lineage (project_id, folder_id);
CREATE INDEX lineage_order_idx ON lineage (project_id, seq);

CREATE TABLE node (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  lineage_id      uuid NOT NULL,
  person_id       uuid,
  path            ltree NOT NULL,
  -- 生成列：由 path 单向派生，不可写（§4.5）
  parent_path     ltree GENERATED ALWAYS AS (
                    CASE WHEN nlevel(path) > 1
                         THEN subpath(path, 0, nlevel(path) - 1) END) STORED,
  kind            text NOT NULL DEFAULT 'primary'
                  CHECK (kind IN ('primary','repeat','annotation')),
  display_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  -- [.] 放进字符类，不依赖 standard_conforming_strings
  CONSTRAINT node_path_format CHECK (path::text ~ '^[0-9]{4}([.][0-9]{4})*$'),
  -- 非延迟：既是整树有序扫的索引，又是自引用 FK 的目标
  CONSTRAINT node_path_unique UNIQUE (project_id, lineage_id, path),
  CONSTRAINT node_annotation_person
    CHECK ((kind = 'annotation') = (person_id IS NULL)),
  CONSTRAINT node_lineage_fk FOREIGN KEY (project_id, lineage_id)
    REFERENCES lineage (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT node_person_fk FOREIGN KEY (project_id, person_id)
    REFERENCES person (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT node_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT,
  -- 闭包：目标是本表已有的 UNIQUE
  CONSTRAINT node_parent_fk FOREIGN KEY (project_id, lineage_id, parent_path)
    REFERENCES node (project_id, lineage_id, path) ON DELETE RESTRICT
);
CREATE INDEX node_person_idx ON node (project_id, person_id);
CREATE UNIQUE INDEX node_one_primary
  ON node (project_id, lineage_id, person_id) WHERE kind = 'primary';
-- 可选：在 genealogy_app + RLS 下不会被选中（§10.1），上线后按 pg_stat_user_indexes 评估是否删除
CREATE INDEX node_path_gist ON node USING gist (project_id, path);

-- ===== [A.5] 谱文层与谱书层 =====

CREATE TABLE article (
  organization_id    uuid NOT NULL,
  project_id         uuid NOT NULL,
  id                 uuid NOT NULL DEFAULT uuidv7(),
  folder_id          uuid,
  title              text NOT NULL CHECK (btrim(title) <> ''),
  kind               text NOT NULL DEFAULT 'other'
                     CHECK (kind IN ('preface','biography','epitaph','rules','research','verse','other')),
  body               text NOT NULL CHECK (btrim(body) <> ''),
  author_text        text,
  date_text          text,
  subject_person_id  uuid,
  lineage_id         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT article_folder_fk FOREIGN KEY (project_id, folder_id)
    REFERENCES folder (project_id, id) ON DELETE SET NULL (folder_id),
  CONSTRAINT article_person_fk FOREIGN KEY (project_id, subject_person_id)
    REFERENCES person (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT article_lineage_fk FOREIGN KEY (project_id, lineage_id)
    REFERENCES lineage (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT article_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX article_folder_idx  ON article (project_id, folder_id);
CREATE INDEX article_person_idx  ON article (project_id, subject_person_id);
CREATE INDEX article_lineage_idx ON article (project_id, lineage_id);

CREATE TABLE book (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  folder_id       uuid,
  title           text NOT NULL CHECK (btrim(title) <> ''),
  edition_text    text,
  compiler_text   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT book_folder_fk FOREIGN KEY (project_id, folder_id)
    REFERENCES folder (project_id, id) ON DELETE SET NULL (folder_id),
  CONSTRAINT book_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX book_folder_idx ON book (project_id, folder_id);

CREATE TABLE book_catalog (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  book_id         uuid NOT NULL,
  path            ltree NOT NULL,
  parent_path     ltree GENERATED ALWAYS AS (
                    CASE WHEN nlevel(path) > 1
                         THEN subpath(path, 0, nlevel(path) - 1) END) STORED,
  title           text NOT NULL CHECK (btrim(title) <> ''),
  article_id      uuid,
  lineage_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT book_catalog_path_format CHECK (path::text ~ '^[0-9]{4}([.][0-9]{4})*$'),
  CONSTRAINT book_catalog_path_unique UNIQUE (project_id, book_id, path),
  CONSTRAINT book_catalog_one_content CHECK (num_nonnulls(article_id, lineage_id) <= 1),
  CONSTRAINT book_catalog_article_once UNIQUE (project_id, book_id, article_id),
  CONSTRAINT book_catalog_lineage_once UNIQUE (project_id, book_id, lineage_id),
  CONSTRAINT book_catalog_book_fk FOREIGN KEY (project_id, book_id)
    REFERENCES book (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT book_catalog_article_fk FOREIGN KEY (project_id, article_id)
    REFERENCES article (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT book_catalog_lineage_fk FOREIGN KEY (project_id, lineage_id)
    REFERENCES lineage (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT book_catalog_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT book_catalog_parent_fk FOREIGN KEY (project_id, book_id, parent_path)
    REFERENCES book_catalog (project_id, book_id, path) ON DELETE RESTRICT
);
CREATE INDEX book_catalog_path_gist ON book_catalog USING gist (project_id, path);
CREATE INDEX book_catalog_article_idx ON book_catalog (project_id, article_id);
CREATE INDEX book_catalog_lineage_idx ON book_catalog (project_id, lineage_id);

-- 导出物元数据：不是内容快照，不与 §2.1 冲突
CREATE TABLE book_export (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  book_id         uuid NOT NULL,
  exported_at     timestamptz NOT NULL DEFAULT now(),
  fact_cutoff     timestamptz NOT NULL,
  artifact_uri    text NOT NULL CHECK (btrim(artifact_uri) <> ''),
  checksum        text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  format          text NOT NULL DEFAULT 'pdf'
                  CHECK (format IN ('pdf','typst','epub','html','other')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT book_export_cutoff CHECK (fact_cutoff <= exported_at),
  CONSTRAINT book_export_book_fk FOREIGN KEY (project_id, book_id)
    REFERENCES book (project_id, id) ON DELETE RESTRICT,
  CONSTRAINT book_export_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX book_export_book_idx ON book_export (project_id, book_id, exported_at DESC);

-- ===== [A.6] 隔离函数、策略与权限收紧 =====

CREATE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

-- 返回数组而不是 SETOF：标量子查询才能成为 InitPlan（§3.3）
CREATE FUNCTION app.visible_org_array() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(array_agg(m.organization_id), '{}'::uuid[])
    FROM public.organization_member m
   WHERE m.user_id = app.current_user_id()
$$;

CREATE FUNCTION app.create_organization(p_name text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user text := app.current_user_id();
  v_org  uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION '未认证' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION '组织名不能为空' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.organization (name, created_by) VALUES (btrim(p_name), v_user)
    RETURNING id INTO v_org;
  INSERT INTO public.organization_member (organization_id, user_id, role)
    VALUES (v_org, v_user, 'owner');
  RETURN v_org;
END $$;

CREATE FUNCTION app.accept_invite(p_token_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, auth, pg_temp AS $$
DECLARE
  v_user  text := app.current_user_id();
  v_email text;
  v_inv   public.invite%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION '未认证' USING ERRCODE = '42501';
  END IF;
  SELECT u.email INTO v_email FROM auth.user u WHERE u.id = v_user;
  SELECT * INTO v_inv FROM public.invite i
   WHERE i.token_hash = p_token_hash
     AND i.status = 'pending' AND i.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '邀请无效或已过期' USING ERRCODE = '22023';
  END IF;
  IF lower(coalesce(v_email, '')) <> v_inv.email THEN
    RAISE EXCEPTION '邀请邮箱与当前账号不匹配' USING ERRCODE = '42501';
  END IF;
  -- 已是成员：显式报错并回滚，邀请不被消费；角色调整走管理员独立写入路径
  IF EXISTS (SELECT 1 FROM public.organization_member m
              WHERE m.organization_id = v_inv.organization_id
                AND m.user_id = v_user) THEN
    RAISE EXCEPTION '当前账号已是该组织成员；角色调整请由管理员执行'
      USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.organization_member (organization_id, user_id, role)
    VALUES (v_inv.organization_id, v_user, v_inv.role);
  UPDATE public.invite SET status = 'accepted', accepted_at = now()
   WHERE organization_id = v_inv.organization_id AND id = v_inv.id;
  RETURN v_inv.organization_id;
END $$;

DO $$
DECLARE
  t text;
  p text := $p$organization_id = ANY (coalesce((SELECT app.visible_org_array()), '{}'::uuid[]))$p$;
  q text;
BEGIN
  q := replace(p, 'organization_id', 'id');
  FOREACH t IN ARRAY ARRAY[
    'organization_member','invite','project','folder',
    'person','person_name','family','family_partner','family_child','event',
    'lineage','node','article','book','book_catalog','book_export'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I FOR ALL USING (%s) WITH CHECK (%s)', t, p, p);
  END LOOP;
  EXECUTE 'ALTER TABLE organization ENABLE ROW LEVEL SECURITY';
  EXECUTE format(
    'CREATE POLICY org_isolation ON organization FOR ALL USING (%s) WITH CHECK (%s)', q, q);
END $$;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO genealogy_app;
GRANT USAGE ON SCHEMA public TO genealogy_app;
-- 业务表 DML 授权：缺它时普通查询报 42501
-- ALTER DEFAULT PRIVILEGES 只对执行本语句的角色以后建的表生效；
-- 每个会建业务表的角色都要单独执行一次，且新表必须自带 ENABLE RLS + org_isolation 策略。
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO genealogy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO genealogy_app;
GRANT EXECUTE ON FUNCTION app.visible_org_array() TO genealogy_app;
GRANT EXECUTE ON FUNCTION app.create_organization(text) TO genealogy_app;
GRANT EXECUTE ON FUNCTION app.accept_invite(text) TO genealogy_app;
-- 纵深防御（默认注释：启用后应用角色不能建临时表）
-- REVOKE TEMPORARY ON DATABASE <db> FROM PUBLIC;
