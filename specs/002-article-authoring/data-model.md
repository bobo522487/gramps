# Phase 1 · 数据模型

> **本期零表结构变更、零迁移。** 唯一的数据层改动是 `article.content` 的**语义**（从单文档变成分页文档包）与派生字段的写法。表结构与约束的权威文档仍是 `docs/architecture/04-数据视图-数据架构.md`（本期只补一段 `content` 结构说明，不改 DDL）。
>
> 图片字节不在数据库里（见 [research.md](./research.md) §3），数据库只记 `pathname`，而 `pathname` 写在文档节点属性里，因此**不新增媒体表**。

## 1. 变更总览

| 对象 | 变更 | 类型 | 影响面 |
|---|---|---|---|
| 数据库表 / 列 / 索引 / 约束 | **无** | — | 无需迁移；空库与既有库一次执行结果相同（无迁移可跑） |
| `article.content` | 语义变更：`{ schemaVersion: 1, pages: [{ id, doc }] }` | JSON 结构 | 新建/保存/打开/列表页数/删除确认 |
| `article.plain_text` | 写法收紧：只由 `derivePlainText()` 派生，页间 `\n\n` | 代码内规则 | 保存页；将来全文检索（FR-044 后置） |
| `article.kind` | 本期不写入（恒为 `NULL`），列保留 | 数据语义 | 无 |
| `article.updated_at` | 保存页/加页/删页/重排/改标题/移分类都写 | 数据语义 | 列表排序（FR-002） |
| 权限枚举 | **不变**（沿用 `content.read` / `article.write`；分类写权限仍用 `project.write`） | — | 见 §6 |
| 活动日志 | 复用既有 `CREATE_ARTICLE` / `UPDATE_ARTICLE` / `DELETE_ARTICLE` | 枚举已存在 | `activity_logs` |
| 媒体存储 | 新增 Vercel Blob 私有 store（生产）/ 文件系统 `.data/media`（本地与 CI） | 基础设施 | 新 env `BLOB_READ_WRITE_TOKEN`（可选）、`.gitignore` 加 `.data/` |

**明确不做**：不加 `article_page` 表（research.md §2）、不加 `page_count` / `article_count` 冗余列（§8）、不加图片表、不改 `book_catalog`、不改 RLS 策略、不加索引、**不设正文字数上限**（规格的边界情况要求超长正文「不截断、不自动分页、保存必须完整」）。

## 2. `article.content` 结构（本期唯一的数据契约）

```jsonc
{
  "schemaVersion": 1,
  "pages": [
    {
      "id": "3f1c…-uuid",               // 文档内页标识，由服务端生成，不是数据库行
      "doc": {                          // ProseMirror 文档（ADR 0010 的边界）
        "type": "doc",
        "content": [
          { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "序" }] },
          { "type": "paragraph", "content": [{ "type": "text", "text": "……" }] },
          {
            "type": "articleImage",
            "attrs": {
              "pathname": "articles/<orgId>/<articleId>/<uuid>.webp",  // 存储内唯一键，不含 URL
              "width": "full"                                        // 'small' | 'medium' | 'full'
            }
          }
        ]
      }
    }
  ]
}
```

**不变量（服务端权威校验，`lib/article/schemas.ts` 的 Zod + `lib/article/doc.ts` 的守卫）**：

| # | 不变量 | 违反时 | 对应 FR |
|---|---|---|---|
| 1 | `schemaVersion === 1` | 拒绝保存，中文提示「内容格式已更新，请刷新页面」 | FR-037 |
| 2 | `1 ≤ pages.length ≤ 100` | 加页被拒：「一篇谱文最多 100 页」 | FR-021 |
| 3 | `pages[].id` 唯一且非空 | 拒绝保存 | FR-037 |
| 4 | 页序 = 数组顺序（无独立 `sort`） | 由结构保证 | FR-023 |
| 5 | 节点白名单：`doc` / `paragraph` / `heading(level ∈ {1,2})` / `text` / `articleImage` | 拒绝保存（清洗后仍不合法才拒） | FR-031、FR-013 |
| 6 | mark 白名单：`textStyle` 内只允许 `fontFamily` / `fontSize`，且取值在白名单 | 拒绝保存 | FR-030、FR-031 |
| 7 | 每页 `articleImage` 节点 ≤ 6 | 拒绝插入：「每页最多 6 张图片」 | FR-028 |
| 8 | `articleImage.attrs.pathname` 必须以 `articles/<orgId>/<articleId>/` 开头 | 拒绝保存（防止引用他人图片） | FR-035 |
| 9 | `articleImage.attrs.width ∈ {small, medium, full}`，缺省 `full` | 归一化为 `full` | FR-026 |

**不设正文字数上限**：第 10 条不变量不存在。超长正文照原样保存（规格明确要求），代价是单行 `jsonb` 变大，由 FR-021 的 100 页上限兜住整体量级。

## 3. 派生字段规则

| 字段 | 规则 | 唯一实现位置 |
|---|---|---|
| `article.plain_text` | 按页序收集所有 `text` 节点，页间以 `\n\n` 连接；`articleImage` 不贡献文本 | `lib/article/doc.ts` 的 `derivePlainText(content)` |
| 页数（列表展示） | `jsonb_array_length(article.content -> 'pages')` | `lib/db/queries/articles.ts` |
| 图片数（删除确认） | 遍历所有页的 `articleImage` 节点计数 | `lib/article/doc.ts` 的 `countImages(content)` |
| 分类篇数 | 见下方 SQL（`kind` 在 `folder` 上，`article.kind` 本期恒 `NULL`） | `lib/db/queries/articles.ts` |
| 地区（只读展示） | `project.countries_regions || '中国'`，谱文不存该字段 | `lib/db/queries/projects.ts` 取 project 时一并带出（research.md §15） |

分类篇数 SQL：

```sql
SELECT a.folder_id, count(*) AS article_count
FROM article a
JOIN folder f ON f.id = a.folder_id AND f.kind = 1 AND f.deleted_at IS NULL
WHERE a.organization_id = $1
  AND a.project_id = $2
  AND a.deleted_at IS NULL
GROUP BY a.folder_id
```

「未分类」篇数 = 该项目谱文总数 − 上述计数之和（不另写一条 SQL）。

**禁止**：任何地方独立写 `plain_text`（ADR 0010）；客户端参与派生（客户端只负责编辑与本地状态）。

## 4. 图片 `pathname` 约定与生命周期

| 项 | 约定 |
|---|---|
| 格式 | `articles/<orgId>/<articleId>/<uuidv4>.<ext>`，`ext ∈ {jpg, png, webp}` |
| 生成 | 上传令牌签发时由服务端拼前缀（`onBeforeGenerateToken` 里校验前缀，客户端只能决定文件名主体） |
| 读取 | 统一走 `GET /api/media/<pathname>`：服务端校验会话 + 组织成员关系后，用服务端凭据 `get(pathname, { access: 'private' })` 取流回传（`fs` 模式读 `.data/media/`）；响应 `Cache-Control: private, max-age=300`。**文档与响应里都不出现存储令牌，也不出现带能力的 URL**（research.md §3） |
| 删除 | 删除页 / 删除谱文 / 移除图片时，在事务提交后对相应 pathname 调 `MediaStore.delete()`；失败只记日志（不回滚软删），可能留孤儿字节（research.md §3 已知限制） |
| 复用 | 同一张图被复制到另一页时，节点复制 `pathname`；删除其中一页**不删字节**，因为另一页仍引用（`isReferenced(pathname, content)` 判定） |
| 跨组织 | `pathname` 前缀含 `orgId`，服务端校验前缀归属；`article.write` 之外无法写入他人前缀 |

## 5. 保存状态与离开保护（客户端模型，非数据库）

| 状态 | 含义 | 转移 |
|---|---|---|
| `idle` | 打开后未改动 | → `dirty`（任意编辑） |
| `dirty` | 有未提交改动，等待 2 秒静默 | → `saving`（定时器到点或「立即保存」） |
| `saving` | 已发请求 | → `saved`（本次提交的页全部成功）/ `error`（任一页失败） |
| `saved` | 已提交的页与服务端一致，带 `savedAt` | → `dirty`（再次编辑） |
| `error` | 至少一页失败，内容仍在内存 | → `saving`（重试）/ 离开前二次确认 |

顶栏状态按**整篇**汇总（FR-014）：只要存在 `dirty` / `saving` / `error` 的页，就不得显示「已保存」。

**离开保护（FR-003 / FR-016，research.md §14）**：

| 离开方式 | 行为 |
|---|---|
| 切页 / 切谱文 / 返回列表（应用内） | `await` 保存所有有改动的页 → 成功后导航；失败停留并提示，不导航 |
| 关闭标签 / 刷新 | `beforeunload` 注册：存在未保存改动时阻止并让浏览器弹出原生确认 |
| 服务端 | 不新增「keepalive 写路由」；写入一律 Server Action |

## 6. 权限矩阵（本期口径：与现状完全一致）

| 能力 | owner | admin | editor | viewer | 权限串 | 依据 |
|---|:--:|:--:|:--:|:--:|---|---|
| 查看谱文与分类 | ✅ | ✅ | ✅ | ✅ | `content.read` | 现状 |
| 新建 / 改标题 / 移分类 / 删谱文 | ✅ | ✅ | ✅ | ❌ | `article.write` | FR-033、FR-036 |
| 保存页 / 加页 / 删页 / 重排页 | ✅ | ✅ | ✅ | ❌ | `article.write` | FR-014、FR-021 |
| 插入 / 移除图片（上传令牌） | ✅ | ✅ | ✅ | ❌ | `article.write` | FR-025、FR-027 |
| 新建 / 重命名 / 删除**谱文**分类 | ✅ | ✅ | ❌ | ❌ | `project.write`（**不变**） | FR-036：本期不改能力矩阵 |
| 新建 / 重命名 / 删除谱系、谱书分类 | ✅ | ✅ | ❌ | ❌ | `project.write`（不变） | 现状 |

**编辑者的两条兜底**（research.md §9）：① 新建谱文时若该项目还没有谱文分类，`createArticleAction` 在**同一事务内**创建「默认分类」（FR-001 的默认行为，不是新增权限）；② 分类管理入口按 `hasPermission(role, 'project.write')` 显隐，编辑者看不到入口，不会出现「点了才被拒」。

## 7. 查询与索引使用（不改索引）

| 用途 | 查询要点 | 用到的既有索引 |
|---|---|---|
| 谱文列表（FR-002） | `org_id = ? AND project_id = ? AND deleted_at IS NULL`，`ORDER BY coalesce(updated_at, created_at) DESC`，带 `jsonb_array_length` 页数与 `folder_id` | `idx_article_project` |
| 单篇打开 | 同上 + `id = ?` | `uk_article_organization_id` + 主键 |
| 分类篇数（FR-040） | 见 §3 的 SQL（`JOIN folder … AND f.kind = 1`） | `idx_article_project` |
| 删除前引用检查（FR-004/FR-038） | `book_catalog c JOIN book b ON b.id = c.book_id`，条件 `c.organization_id = ? AND c.article_id = ? AND c.deleted_at IS NULL AND b.deleted_at IS NULL` | `idx_catalog_article` |
| 分类删除预览（FR-005） | 先 BFS 该分类子树，再按 `folder_id IN (…)` 数谱文与图片数 | `idx_article_project` |
| 标题搜索（FR-007，P1） | `title ILIKE '%?%'` 项目内 | 顺序扫描（200 篇量级足够，不新增索引） |

## 8. 迁移与回滚

- **无迁移**：`lib/db/migrations/` 不新增文件，`_journal.json` 不变，迁移漂移检查自然通过。
- 结构变更的风险点只有一个：`article` 表若有历史行（当前功能未上线，理论上 0 行），其 `content` 仍是旧形状。`lib/article/doc.ts` 的 `parseArticleContent()` 对「非 `schemaVersion: 1` 的旧值」返回 `{ schemaVersion: 1, pages: [空页] }` 并记日志（不抛错、不阻塞打开），用户下次保存即写成新结构。
- 回滚：代码回滚即可；Blob 里的孤儿字节与 `.data/media` 里的文件不参与回滚（无外键、无引用）。
