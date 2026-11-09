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
-- 附录 A.0 的 `auth.user` 是**最小契约**（`email UNIQUE` 内联，只有 id / email /
-- name / created_at），因为它只用来满足 `REFERENCES auth.user(id)` 与
-- `app.accept_invite` 读邮箱两件事。但 Better Auth 的 adapter 对这张表是全字段
-- 读写：登录查 `email_verified / image / created_at / updated_at`，建号写全列。
-- 缺列的症状是运行期 `column "email_verified" does not exist`，不是启动报错。
-- 所以这里按「附录 A.0 的超集」建表：A.0 的四个列语义不变，另补 adapter 必需列。
-- `email` 的唯一约束改用 lower(email) 表达式索引（保留 A.0 的「邮箱唯一」语义，
-- 但不区分大小写），故不再内联 UNIQUE。
CREATE TABLE IF NOT EXISTS auth.user (
  -- `id` 在附录 A.0 里是无默认值的 text 主键（它只是让 REFERENCES 成立的最小
  -- 契约）。但应用侧 advanced.database.generateId = false，ID 一律由数据库生成，
  -- 所以这里补默认值：缺了它就是建号时 `null value in column "id"`。
  -- 形状对齐 lib/db/schema/shared.ts 的 uuidPk 默认（uuidv7 转 text）。
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email          text NOT NULL,
  name           text,
  email_verified boolean NOT NULL DEFAULT false,
  image          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_auth_user_email ON auth.user (lower(email));
CREATE INDEX IF NOT EXISTS idx_auth_user_email ON auth.user (email);

-- 若 auth.* 由别的角色拥有（生产环境由 Better Auth 建表），需由该属主执行：
--   GRANT USAGE, CREATE ON SCHEMA auth TO <ddl_role>;
--   GRANT SELECT, REFERENCES ON auth.user TO <ddl_role>;
-- 注意：CREATE TABLE IF NOT EXISTS 也要求 CREATE ON SCHEMA，仅 USAGE 不够（42501）。
-- app.accept_invite 的函数属主另需 USAGE ON SCHEMA auth + SELECT ON auth.user，
-- 否则 SECDEF 内读 auth.user.email 报 42501（permission denied for table user）。
-- 以 postgres 为属主时天然具备，以上授权可跳过。

-- Better Auth 运行期表（附录 A 之外，按规格决议 ②：DDL 归 Better Auth 管理，
-- 本仓保留 TS 镜像）。`auth.user` 由 A.0 建为 text 主键骨架，其余三张表 Better
-- Auth 的 adapter 必需——缺任一张，登录 / 会话 / 成员管理整条链路都不可用
-- （`relation "auth.session" does not exist`）。列定义对齐 lib/db/schema/auth.ts。
-- 主键用 text 而非 uuid：外键列必须与 auth.user(id) 的 text 类型一致，否则 42804。
CREATE TABLE IF NOT EXISTS auth.account (
  id                      text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id              text NOT NULL,
  provider_id             text NOT NULL,
  user_id                 text NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  access_token            text,
  refresh_token           text,
  id_token                text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                   text,
  password                text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_auth_account_provider_account
  ON auth.account (provider_id, account_id);
CREATE INDEX IF NOT EXISTS idx_auth_account_user ON auth.account (user_id);

CREATE TABLE IF NOT EXISTS auth.verification (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_verification_identifier
  ON auth.verification (identifier);
CREATE INDEX IF NOT EXISTS idx_auth_verification_expires
  ON auth.verification (expires_at);

-- ===== [A.1] 扩展与域类型 =====

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- uuid 的 GiST opclass
CREATE SCHEMA IF NOT EXISTS app;

CREATE DOMAIN member_role_t AS text
  CHECK (VALUE IN ('owner','admin','editor','viewer'));

-- `organization.slug` / `project.ref` 的默认值来源（附录 A 之外，但代码与路由
-- 都依赖它：/dashboard/[orgSlug] 与 /dashboard/[orgSlug]/project/[projectRef]）。
-- 20 位无连字符十六进制，不暴露 uuid 的版本位。
CREATE OR REPLACE FUNCTION public.generate_public_id() RETURNS text
  LANGUAGE sql VOLATILE AS $$
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
$$;

-- ===== [A.2] 边界层 =====

CREATE TABLE organization (
  id          uuid NOT NULL DEFAULT uuidv7(),
  -- 四条扩展列，附录 A.1 之外，登记在 docs/data-model.md §4「路由键与状态扩展列」：
  --   slug      URL 第一段 /dashboard/[orgSlug] 的路由键
  --   status    active / suspended / closed；关停语义（原 deleted_at）靠它表达
  --   logo      Better Auth organization 模型字段（organization.mjs: schema.organization.fields）
  --   metadata  同上，Better Auth 以 text 存取（adapter 会 JSON.stringify）
  slug        text NOT NULL DEFAULT public.generate_public_id(),
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'suspended', 'closed')),
  logo        text,
  metadata    text,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  created_by  text REFERENCES auth.user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
-- 无软删后 slug 是全量唯一，不再是 where deleted_at is null 的部分索引。
CREATE UNIQUE INDEX uk_organization_slug ON organization (slug);

-- A.0 的 auth.session 需要 organization(id)，所以放在 organization 之后建。
CREATE TABLE IF NOT EXISTS auth.session (
  id                     text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  expires_at             timestamptz NOT NULL,
  token                  text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  ip_address             text,
  user_agent             text,
  user_id                text NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  active_organization_id uuid REFERENCES organization(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_auth_session_token ON auth.session (token);
CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth.session (user_id);

CREATE TABLE organization_member (
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  user_id         text NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  role            member_role_t NOT NULL DEFAULT 'viewer',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE UNIQUE INDEX uk_org_member_single_owner
  ON organization_member (organization_id) WHERE role = 'owner';
CREATE INDEX organization_member_user_idx ON organization_member (user_id, organization_id);

CREATE TABLE invite (
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  id              uuid NOT NULL DEFAULT uuidv7(),
  email           text NOT NULL
                  CHECK (email = lower(email)
                         AND btrim(email) <> ''
                         AND position('@' IN email) > 1),
  role            member_role_t NOT NULL DEFAULT 'viewer' CHECK (role <> 'owner'),
  -- 具名约束，不用 `UNIQUE` 内联：内联时 PostgreSQL 自动起名
  -- `invite_token_hash_key`，名字一旦成为应用重试分支的判断依据，就必须
  -- 显式钉住——重新排一次 DDL、换个建表顺序，自动名都可能变。
  -- 默认值同样不是为了「忘了传 token」：唯一写入路径（lib/org/invitations.ts）
  -- 每次都显式写它。挂默认值是为了让 Better Auth 1.7.12 的 schema 自检
  -- 放过这一列——插件的 invitation 模型不写 token_hash，自检遇到
  -- 「非空 + 无默认值的列」会判定每次插入都失败，并在每个用到 auth 的请求上
  -- 打一条 ERROR。默认值是一条永远匹配不上任何明文 token 的随机串。
  token_hash      text NOT NULL
                  DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
                  CONSTRAINT invite_token_hash_key UNIQUE,
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
  -- 文档化扩展列（docs/data-model.md §4）：URL 第二段
  -- /dashboard/[orgSlug]/project/[projectRef] 的路由键，创建后不可变。
  ref             text NOT NULL DEFAULT public.generate_public_id(),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  -- 以下六列同样是扩展列：附录 A.2 的 project 只有 name / description，
  -- 但产品形态（堂号、郡望、迁徙地域、字辈、编修状态、重要度）都落在这里，
  -- 且 UI / 查询 / 排序都在用。逐列登记在 docs/data-model.md §4。
  theme_name      text,
  surname         text,
  countries_regions text,
  hall_code       text,
  status          text NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('planning','in_progress','completed')),
  importance      smallint NOT NULL DEFAULT 1
                  CHECK (importance BETWEEN 1 AND 5),
  -- 族内婚的项目级开关：为 true 时 app.check_family_blood_side() 不再强制
  -- 「一个家庭至多一位血亲配偶」。默认 false，因为这条不变量才是本意。
  allow_consanguineous_marriage boolean NOT NULL DEFAULT false,
  notes           text,
  description     text,
  -- 附录 A.2：text REFERENCES auth.user(id) ON DELETE SET NULL——可空，
  -- 因为销号不该连带卡死项目。
  created_by      text REFERENCES auth.user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  -- 全局唯一：两个组织不能拥有同 id 的项目，否则项目内复合 FK 可跨组织引用（§4.1）
  CONSTRAINT project_id_global UNIQUE (id)
);
-- 与 lib/db/schema/project.ts 的 uniqueIndex('uk_project_ref').on(t.ref) 逐字对齐：
-- `ref` 是全局唯一，不加 organization_id 限定（它由 generate_public_id() 生成，
-- 20 位十六进制碰撞可忽略，且跨组织撞 ref 只会让一方 409，不会泄漏存在性）。
CREATE UNIQUE INDEX uk_project_ref ON project (ref);
CREATE INDEX project_created_idx ON project (organization_id, created_at);

CREATE TABLE folder (
  organization_id uuid NOT NULL,
  project_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  -- 以下四列是**待拍板的规格差异**（docs/data-model.md §8 #14）：附录 A.2 的
  -- folder 是扁平单层，没有 kind / parent_id / sort / created_by。但当前实现
  -- 支持多级分类，UI、查询与删除逻辑都在用，基线必须建出来否则运行期 42703。
  -- 层级去留已升级为独立规格问题，必须在 B3 开工前拍板（三条路见 §8 #14）。
  kind            smallint NOT NULL CHECK (kind IN (0, 1, 2)),
  parent_id       uuid,
  sort            integer NOT NULL DEFAULT 0,
  created_by      uuid NOT NULL,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  -- 附录 A.2 的 `seq` 与实现里的 `sort` 语义重复，保留 seq 以免与附录脱节；
  -- 拍板后二选一。
  seq             integer NOT NULL DEFAULT 0 CHECK (seq >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT folder_name_unique UNIQUE (project_id, name),
  CONSTRAINT folder_scope_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES project (organization_id, id) ON DELETE RESTRICT,
  -- 父目录必须同组织同项目
  CONSTRAINT uk_folder_org_project_id UNIQUE (organization_id, project_id, id),
  CONSTRAINT fk_folder_parent_same_project
    FOREIGN KEY (parent_id, organization_id, project_id)
    REFERENCES folder (id, organization_id, project_id) ON DELETE RESTRICT
);
CREATE INDEX folder_order_idx ON folder (project_id, seq);
CREATE INDEX idx_folder_project ON folder (organization_id, project_id, kind);

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

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

-- 返回数组而不是 SETOF：标量子查询才能成为 InitPlan（§3.3）
CREATE OR REPLACE FUNCTION app.visible_org_array() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(array_agg(m.organization_id), '{}'::uuid[])
    FROM public.organization_member m
   WHERE m.user_id = app.current_user_id()
$$;

CREATE OR REPLACE FUNCTION app.create_organization(p_name text) RETURNS uuid
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

CREATE OR REPLACE FUNCTION app.accept_invite(p_token_hash text) RETURNS uuid
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
     -- 组织关停后其邀请必须失效。目标态没有软删，组织行还在表里，
     -- 少了这个条件就能往已关停组织里继续塞人（旧实现靠
     -- trg_invite_active_org 触发器兜，这里改在唯一的写入路径本体内判）。
     AND EXISTS (SELECT 1 FROM public.organization o
                  WHERE o.id = i.organization_id AND o.status <> 'closed')
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

-- 供应用层在「接受邀请」入口判断目标组织是否还收人。
--
-- SECURITY DEFINER 是必需的：调用者此刻还不是该组织的成员，organization 的
-- org_isolation 策略让他看不见这一行，而这条判断恰恰要读行本身。
-- 只返回一个枚举值，不泄漏组织名、成员、时间戳——比放开整行可见性安全得多。
--
-- 为什么是三态而不是布尔：`false` 同时覆盖「组织已关停」与「组织不存在」，
-- 调用方只能给出一句含糊的「无法加入」，用户不知道该找管理员还是邀请已作废。
-- `text` 而不是 enum：多一个类型就多一处 DDL 迁移，而取值集合由 CHECK 钉住。
--
-- 为什么需要它：当前生效的接受邀请路径是 Better Auth 的 `acceptInvitation`，
-- 它只校验邀请自身的 status / expiresAt，**不看 organization.status**。
-- `app.accept_invite` 里的同款谓词要到 B2b 邀请流程改造后才成为主路径。
CREATE OR REPLACE FUNCTION app.organization_join_state(p_org_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(
    (SELECT o.status::text FROM public.organization o WHERE o.id = p_org_id),
    'missing')
$$;

-- 兼容壳：B0b 已合入的那一版返回 boolean，保留它可以让迁移重放与
-- 外部脚本（verify-deployment 的旧断言、运维手敲的探针）不因改名而断。
-- 语义严格是上面那个函数的投影，不是第二套判断。
CREATE OR REPLACE FUNCTION app.organization_is_open(p_org_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.organization_join_state(p_org_id) = 'active'
$$;

-- 待加入者在点「加入」之前要看到「我要加入的是哪个组织、以什么角色」。
-- 此刻他还不是成员，`invite` 的 org_isolation 让他在那张表上一行都看不见，
-- 而放开 SELECT 等于把同组织**全部待发邀请的邮箱**摆给他看。
-- 所以只放一个按 token_hash 精确寻址的预览函数，只回该邀请指向的组织名与角色。
--
-- 不回 email：调用方自己知道邮箱，回显它只是把「这张邀请是发给谁的」泄漏给
-- 任何一个拿到链接的人。不回 id：自建 token 之后 id 不该出现在任何对外的
-- 形状里，否则有人会顺手拿它当凭据（正是 B2b 要废掉的那条路）。
--
-- STABLE 而非 VOLATILE：只读一行，可在同一语句内被规划器复用。
-- 返回 NULL（不是抛错）：调用方要区分「链接无效」与「权限问题」，
-- 而这里唯一的失败原因就是链接无效。
CREATE OR REPLACE FUNCTION app.invite_join_preview(p_token_hash text)
RETURNS TABLE (organization_name text, role text, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT o.name, i.role::text, i.expires_at
    FROM public.invite i
    JOIN public.organization o ON o.id = i.organization_id
   WHERE i.token_hash = p_token_hash
     AND i.status = 'pending'
     AND i.expires_at > now()
$$;

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

-- ===== [A.6.1] 租户键不可变守卫 =====
--
-- 规格 §5.3「0 业务触发器」的**第 1 类例外**（第 2 类是 A.6.2），
-- 理由写进 §5.3 的例外表与 §9：
--
--   RLS 的 USING 只看 OLD 行、WITH CHECK 只看 NEW 行，PostgreSQL 里不存在
--   任何策略组合能比较这两行。于是同属两个组织的用户执行
--   `update project set organization_id = <他组织>` 时，USING（old 属于他的组织 A）
--   与 WITH CHECK（new 属于他的组织 B）**各自都成立**，行就被搬走了。
--   这是 2026-10-29 数据模型评审的 P0 项：权限提升路径，不是理论风险。
--   BEFORE UPDATE 触发器是 PostgreSQL 里唯一同时看得到 OLD 与 NEW 的地方。
--
-- 它不是业务逻辑：函数只 RAISE，不写任何数据，一个函数服务全部 16 张表。
-- 备选方案「列级 REVOKE UPDATE + GRANT UPDATE (可写列)」实测同样能拦住
-- （改 org_id 报 42501），但那是**白名单**：目标态还要继续加列（B3 的
-- book_catalog.path、T27 的 article.body），每次加列忘了补 GRANT 就是 42501，
-- 失败形态是「功能坏」而不是「测试红」。黑名单式（枚举不可变列）维护成本低得多，
-- 且租户键是稳定集合——一年也不会新增一个。
--
-- 新增组织作用域表必须在本清单里加一行，`trg_<table>_tenant_immutable` 由
-- scripts/verify-deployment.mjs 与 tests/integration/tenant-immutability.test.ts
-- 双向断言，漏了会红。

CREATE OR REPLACE FUNCTION app.forbid_tenant_move() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  col text;
BEGIN
  -- 零参数 = 零次迭代 = 静默放行整张表。清单里写成 `ARRAY[]`、或某次
  -- string_agg 因为数组全空而返回 NULL，都会落到这里，所以显式拦掉。
  IF coalesce(array_length(TG_ARGV, 1), 0) = 0 THEN
    RAISE EXCEPTION 'guard trigger on % was created without tenant columns', TG_TABLE_NAME
      USING ERRCODE = '42725',
            HINT = 'pass at least one column to app.forbid_tenant_move()';
  END IF;

  FOREACH col IN ARRAY TG_ARGV LOOP
    -- 手写参数清单的护栏：`to_jsonb(NEW) -> 'typo'` 在两边都是 NULL，
    -- 下面的比较恒不成立，那张表就被静默放行了。42703 让拼错在第一次
    -- UPDATE 时就炸出来，而不是留一个看起来有守卫的空壳。
    IF NOT (to_jsonb(NEW) ? col) THEN
      RAISE EXCEPTION 'tenant column % does not exist on %', col, TG_TABLE_NAME
        USING ERRCODE = '42703';
    END IF;

    -- IS DISTINCT FROM 而非 `<>`：租户列若可空，NULL <> NULL 求值为 NULL，
    -- 会把 NULL -> 值的搬移放过去。
    IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION 'column %.% is immutable', TG_TABLE_NAME, col
        USING ERRCODE = '42501',
              HINT = 'tenant and ownership columns cannot be reassigned; create a new row instead';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- 边界层：成员行连 user_id 一起钉住——成员身份是「谁在这个组织里」，
      -- 允许改 user_id 等于允许把成员行改写给任意账号。
      ('organization_member', ARRAY['organization_id', 'user_id']),
      ('invite',              ARRAY['organization_id']),
      -- 项目容器：organization 是租户键，project 是二级键
      ('project',             ARRAY['organization_id']),
      ('folder',              ARRAY['organization_id', 'project_id']),
      -- 谱系层：parent_id / path 可自由移动（挪节点是合法操作），租户键不可。
      -- node 必须连 project_id 一起钉：lineage 的主键是 (project_id, id)，
      -- 只钉 lineage_id 时，在一个项目里造一条同 id 的 lineage 就能把节点
      -- 连同 org 一起搬到那个项目（uuid 由调用方指定，不是碰撞概率问题）。
      ('lineage',             ARRAY['organization_id', 'project_id']),
      ('node',                ARRAY['organization_id', 'project_id', 'lineage_id']),
      -- 事实层：四张表同形状
      ('person',              ARRAY['organization_id', 'project_id']),
      ('person_name',         ARRAY['organization_id', 'project_id']),
      ('family',              ARRAY['organization_id', 'project_id']),
      ('family_partner',      ARRAY['organization_id', 'project_id']),
      ('family_child',        ARRAY['organization_id', 'project_id']),
      ('event',               ARRAY['organization_id', 'project_id']),
      -- 谱文层：folder_id 是归档位置（可改），project 才是租户键
      ('article',             ARRAY['organization_id', 'project_id']),
      ('book',                ARRAY['organization_id', 'project_id']),
      -- 同理 book 的主键是 (project_id, id)，只钉 book_id 挡不住跨项目搬目录。
      ('book_catalog',        ARRAY['organization_id', 'project_id', 'book_id']),
      ('book_export',         ARRAY['organization_id', 'project_id'])
    ) AS v(tbl, cols)
  LOOP
    -- CREATE OR REPLACE（PG14+）：`psql -f` 逐句自动提交，若先 DROP 再 CREATE，
    -- 两条语句之间有一段「触发器已删、新的还没建」的真空窗口。基线本身在
    -- 干净 schema 上跑，但重放 / 演练时这个窗口是真实的。
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move(%s)',
      'trg_' || r.tbl || '_tenant_immutable', r.tbl,
      (SELECT string_agg(quote_literal(c), ', ') FROM unnest(r.cols) AS c));
  END LOOP;
END $$;

-- ===== [A.6.2] 注册即建个人组织 =====
--
-- 为什么是触发器而不是应用层钩子：Better Auth 的 `databaseHooks.user.create.after`
-- 走 `queueAfterTransactionHook`，源码注释写明 "runs the hooks queued ...
-- once the work commits"——它**在事务提交之后**才跑。钩子一旦失败，用户行已经
-- 落地，只能留下「有账号、无组织」的半截状态，而 getPersonalOrg 会返回 null，
-- 用户所有页面都进不去。补偿式删除同样不可靠（进程崩了就没有补偿）。
-- 同一事务内的 AFTER INSERT 触发器是唯一能做到「要么都成、要么都不成」的位置。
--
-- 这不是业务逻辑：它只做两件插入，且插入值全部来自 auth.user 行本身。
-- 与 A.6.1 一起构成规格 §5.3「0 业务触发器」的两个完整性守卫例外（见 §9）。

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_org  uuid;
  v_name text;
BEGIN
  -- 组织名优先取 Better Auth 写入的 name，其次邮箱本地部分，最后兜底。
  -- organization.name 有 CHECK (btrim(name) <> '')，所以三级都必须非空。
  -- 每一级都要 btrim 后再判空：`split_part('  @x','@',1)` 是 `'  '`，
  -- 非空串，会跳过兜底，然后撞 organization.name 的 CHECK (btrim(name) <> '')，
  -- 整笔注册回滚——一个格式奇怪的邮箱就能让新用户永远注册不上。
  v_name := coalesce(
    nullif(btrim(new.name), ''),
    nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    '我的家族');

  INSERT INTO public.organization (name, created_by)
    VALUES (v_name, new.id)
    RETURNING id INTO v_org;

  INSERT INTO public.organization_member (organization_id, user_id, role)
    VALUES (v_org, new.id, 'owner');

  RETURN new;
END $$;

-- CREATE TRIGGER 没有 OR REPLACE，重跑 `psql -f` 会撞 42710。
DROP TRIGGER IF EXISTS trg_auth_user_created ON auth.user;
CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.user
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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
GRANT EXECUTE ON FUNCTION app.organization_join_state(uuid) TO genealogy_app;
GRANT EXECUTE ON FUNCTION app.organization_is_open(uuid) TO genealogy_app;
GRANT EXECUTE ON FUNCTION app.invite_join_preview(text) TO genealogy_app;
-- 触发器执行本身不检查 EXECUTE（实测：has_function_privilege = false 时
-- UPDATE 照样触发并抛错），这里授权是为了另一件事——部署若用非属主角色
-- CREATE TRIGGER，PostgreSQL 会在建触发器时检查 EXECUTE 并报 42501。
GRANT EXECUTE ON FUNCTION app.forbid_tenant_move() TO genealogy_app;
-- 纵深防御（默认注释：启用后应用角色不能建临时表）
-- REVOKE TEMPORARY ON DATABASE <db> FROM PUBLIC;
