# 领域术语表（Glossary）

> **回答什么问题**：每个词指什么、不许叫成什么。
> **读者**：全员 · AI Agent　**长度上限**：2 页
> **不写什么**：表结构与关系（`docs/data-model.md`）、接口契约（`docs/contracts/`）、实现机制（`docs/architecture.md`）、技术阈值（`docs/nfr.md`）。

全项目**唯一**术语表。spec / plan / tasks / 代码 / 接口字段一律从这里取名。同一实体出现两种叫法，agent 就会写出两套模型。

---

## 1. 使用规则

1. 新增术语**先加本表**，再改引用方；禁止在 spec 里「顺手」定义同义词。
2. 「禁用同义词」列是可执行的检查，评审时跑：

```bash
grep -rn -E "工作区|家谱空间|人物|人员|节点|回收站|家谱系统" specs/ docs/
```

命中即视为术语漂移，打回改词，不改本表去迁就它。

3. 作废的词**保留行并标注**，不删行——历史 spec 还要靠它追溯。
4. 本表只对齐**语言**；实体结构与关系在 `docs/data-model.md`，两者不合并。

---

## 2. 术语表

| 术语 | 唯一标识 | 定义 | 禁用同义词 | 实现位置 |
| --- | --- | --- | --- | --- |
| 云谱 | — | 产品名，谱牒编纂平台 | 家谱系统、谱牒系统 | 品牌 |
| 组织 | `organization` | 租户边界：一个家族或一个修谱工作室 | 云谱空间、团队、工作区 | `org.ts` → `organization` |
| 云谱空间 | `project` | 组织内的一套族谱资料集合，一个组织可有多个 | 工作区、家谱空间 | `project.ts` → `project` |
| 组织成员 | `organization_member` | 账号与组织的关系，角色 `owner`/`admin`/`editor`/`viewer` | 人丁、成员（单独出现时） | `org.ts` |
| 邀请 | `invite` | 一次性加入组织的链接，7 天过期 | 邀请码 | `org.ts` |
| 分类 | `folder` | 谱系 / 谱文 / 谱书三棵树的层级节点 | 目录（与编目混淆） | `project.ts` → `folder` |
| 谱系 | `lineage` | 一棵世系树，一个云谱空间可有多个 | 家谱（家谱指整本谱）、树 | `lineage.ts` → `lineage` |
| 人丁 | `node` | 谱系中的一个人物条目；`node` 是位置引用，身份 / 姓名 / 生卒等事实分别在 `person` / `person_name` / `event` | 成员、人物、人员、节点 | `lineage.ts` → `node` |
| 世次 | `generation` | 第几世，始祖为 1；可比树深，不能比树浅 | 代数、深度 | `lineage.ts` → `node.generation` |
| 字辈 | `generation_words` | 用于命名的辈分用字序列，谱系级 | 派语、辈分字 | `lineage.ts` → `lineage.generation_words` |
| 谱文 | `article` | 独立文章：谱序、凡例、传记、像赞 | 文章、文档 | `content.ts` → `article` |
| 谱书 | `book` | 一本书的元信息与封面配置，**不含正文** | 书籍、成品 | `content.ts` → `book` |
| 编目 | `book_catalog` | 谱书目录，引用谱系或谱文 | 目录、章节 | `content.ts` → `book_catalog` |
| 公开 ID | `slug` / `ref` | URL 里 20 位随机字符串，只用于定位，**不是授权凭证** | 主键、UUID（对外） | `org.ts` / `project.ts` |
| 事实层 | `person` / `person_name` / `family` / `family_partner` / `family_child` / `event` | 身份、姓名、亲属关系与生卒等事实的**主数据源**，由应用直接读写；谱系层 `node` 只引用它 | 人丁表、新表 | `person.ts` / `family.ts` / `event.ts` |
| 软删 | `deleted_at` | 业务表删除标记，查询默认过滤；**没有回收站 UI** | 回收站、可恢复删除 | 业务表通用列 |
| 硬删 | — | 物理删除、不可恢复，用于组织成员与邀请 | 软删 | `org.ts` |
| 谱系工作区 | — | 谱系编辑页的整块交互区域，UI 状态存 zustand | 工作区（单独出现时含义不明） | `components/lineage/` |
| Server Action | — | 唯一写通道 | API、接口 | `lib/<domain>/actions.ts` |
| Route Handler | — | 只读 HTTP 入口，不承担写入 | 写入口 | `app/api/**/route.ts` |

> 软删 / 硬删两条定义与目标态删除语义不一致，待 T23 跟改，本批不改。

---

## 3. 已消除的双口径

同一个词曾指两样东西，是术语表最该消灭的东西。以下以**代码与对象模型**为准，不再保留第二种用法。

| 词 | 曾有第二种用法 | 以哪个为准 | 依据 |
| --- | --- | --- | --- |
| 云谱空间 | 被当作「组织」在产品里的别名、一个租户边界 | `project`，组织内的一套资料集合 | 对象模型：组织 → 云谱空间 → 分类 / 谱系 / 谱文 / 谱书；导航 L2 称「云谱空间首页」；`project.ts` 定义 `project` 与 `folder` |
| 人丁 | 被叫「成员」「人物」「节点」 | `node` 是位置引用，身份事实在事实层 | `lineage.ts` 的 `node` 表 |
| 谱系 | 被叫「家谱」 | `lineage`；「家谱」只指整本谱 | `lineage.ts` 的 `lineage` 表 |
| 事实层 | 被叫「人丁表」「新表」 | 六张表构成的主数据源，应用直接读写 | `person.ts` / `family.ts` / `event.ts` |
| 软删 | 被当成「可恢复」 | 不可恢复，恢复靠运维 | 业务表 `deleted_at`；无回收站 UI |

---

## 4. 不进本表的词

实现机制词汇（`ltree`、物化路径、复合外键、RLS、`SET LOCAL`、`AsyncLocalStorage`、Flight、HydrationBoundary、fitness function、豁免清单）**不在这里定义**，归 `docs/architecture.md` 与 `docs/data-model.md`。

把它们塞进术语表，会让语言表被实现细节污染，两边都难维护——这正是「glossary 与 data-model 不能合一」的原因。
