# Phase 0 · 研究记录（决策与放弃的方案）

> 输入是 [spec.md](./spec.md) 与 `## Assumptions` 里 6 条待确认项。本文件把每一条落成**一个决策**，并写清放弃的方案与重估触发条件；`plan.md` 的 Technical Context 里不允许再留 `NEEDS CLARIFICATION`。
>
> 结论先行：**零数据库迁移**（`article.content` 改语义，不加表）、**安装 TipTap 3**（兑现 ADR 0010）、**图片字节走 Vercel Blob 私有 store + 服务端代理读取**（新 ADR 0019）、本地/CI 用文件系统驱动兜底、**权限口径不动**（FR-036 禁止改变能力矩阵）。

---

## 1. 编辑器引擎：安装 TipTap 3，只启用最小节点集

**Decision**：`article.content` 存 ProseMirror JSON（ADR 0010 已定），引擎用 TipTap 3：`@tiptap/react`、`@tiptap/core`、`@tiptap/pm`、`@tiptap/starter-kit`、`@tiptap/extension-text-style`、`@tiptap/extension-image`。启用集合固定为：`doc` / `paragraph` / `heading(level 1..2)` / `text` / `undoRedo`（TipTap 3 的撤销重做扩展，FR-019）/ `articleImage`（用 `Image.extend({ name: 'articleImage' })` 改名并加 `width` 属性）/ `textStyle + fontFamily + fontSize`（P2）。**禁用** `bold` `italic` `strike` `code` `codeBlock` `blockquote` `bulletList` `orderedList` `horizontalRule` `link` `underline` `color` `highlight`——FR-031 与 FR-044 明令不做，禁用写在 StarterKit 配置里，不是靠 UI 不显示。

**Rationale**：ADR 0010 已经把边界定在 ProseMirror JSON（不存 HTML），本期只是把它从「决策 ≠ 安装」变成「安装」。ADR 0009 §1 要求新增依赖必须替换掉一段自写代码或涉及协议细节：手写 contenteditable 的选区/撤销/输入法/粘贴清洗就是这类高风险逻辑（远超 100 行），符合记账口径。

**Alternatives considered**：
- 裸用 ProseMirror：依赖更少，但选区命令、React 绑定、扩展组合都要自己写，收益为负。
- Lexical：ADR 0010 已评审并排除（JSON 边界与仓库既有约定不一致）。
- 纯 textarea + Markdown：无法表达「块级图片 + 三档宽度」与两级标题的结构可还原性（FR-039）。
- 自己写 contenteditable：撤销栈与中文输入法组合态是最容易出错的部分，自写风险高于维护依赖。

**连带改动（必须与安装同批提交）**：
1. `docs/decisions/0010-rich-text-editor-selection.md` **删掉「尚未安装」状态句**（决策正文不动）；`docs/decisions/README.md` 的 ADR-12 行同步。
2. `tests/docs-consistency.test.ts` 的 `expect(adr).toContain('决策 ≠ 现在安装')` 是**无条件断言，必须保留**；紧随其后的「依赖黑名单」只在 ADR 仍含「尚未安装」时生效——因此删掉状态句后黑名单自动跳过，测试仍然全绿（该测试自己的注释写明这是设计意图）。
3. `biome.json` 增加 `noRestrictedImports`：`@tiptap/*` 只允许 `lib/article/**` 与 `components/article/editor/**`，防止编辑器泄漏到其他客户端组件。

**重估触发**：TipTap 4.x 发布；块级节点需求超过 5 种；需要协同编辑（ADR 0010 已列为触发条件）。

---

## 2. 页面存储：`article.content` 承载「分页文档包」，不新建 `article_page` 表

**Decision**：`article.content` 的 JSON 结构从「单文档」改为：

```jsonc
{ "schemaVersion": 1, "pages": [ { "id": "<uuid>", "doc": { /* ProseMirror doc */ } } ] }
```

页序 = `pages` 数组顺序；页 id 由**服务端**在加页/建篇时生成（`crypto.randomUUID()`），**不是数据库行**。本期**不加表、不加列、不加索引**。

**Rationale**：
- 页序是「成稿顺序」这一条事实，数组顺序天然唯一，不存在「数组顺序 vs `sort` 列」两个真相。
- 零迁移：`article` 表已落库（`content jsonb NOT NULL`），谱文功能尚未上线、无存量数据，改语义不需要回填。
- 加/删/重排页都是同一份 JSON 的一次事务内读改写，与保存页共用一条写路径（§6）。
- 单篇上限 100 页（FR-021），按 100 页 × 约 3KB 估算文档量级在数百 KB，`jsonb` 单行重写代价可接受；20 页 40 图（SC-003）远低于此。

**不做长度截断**：规格的边界情况写明「单页内容很长时不截断、不自动分页，保存必须完整」，因此**不设正文字数上限、不因超长拒绝保存**；只在页数（FR-021）与图片数（FR-028）上设上限。

**Alternatives considered**：
- 新建 `article_page` 表：行级更新更省，但要多一份迁移 + RLS 策略 + `app_rw` 授权 + 页序唯一约束 + 删页重排序号，且 `article.content` 变成死列（`NOT NULL` 又不能删），单一事实来源反而变差。
- 一页一篇谱文（`article` 加 `page_no`）：与「一篇谱文 = 一册小书」的产品语义冲突。
- 页内容另存文件/对象存储：正文是结构化数据不是字节，检索与后续排版都要读结构。

**重估触发**：单篇页数上限提到 1000 页以上；或出现「同一篇被多人同时按页编辑」的真实诉求。

---

## 3. 图片字节：Vercel Blob 私有 store + **服务端代理读取**

**Decision**：图片字节存 Vercel Blob **私有 store**（`@vercel/blob` ≥ 2.3）。文档里只存 `pathname`（`articles/<orgId>/<articleId>/<uuid>.<ext>`）与显示宽度，**不存任何 URL**。读取统一走本站路由 `GET /api/media/<pathname>`：服务端校验会话与组织成员关系后，用服务端凭据 `get(pathname, { access: 'private' })` 取流并回传字节（`Cache-Control: private, max-age=300`）。

**Rationale**：
- FR-035 要求「谱文与图片 MUST NOT 跨组织访问，公开 ID MUST NOT 被当作授权凭证」。**每个请求都在服务端重新授权**，这是最强的一档；URL 本身不含任何能力。
- 放弃「逐 pathname 签发签名 URL」：Vercel Blob 的 `issueSignedToken` 是控制面调用，pathname 只支持精确路径或 `*`。40 张图 = 40 次往返，直接威胁 SC-003（切页 <300ms）；退化成 `*` 又把「整个 store 的读权限」发给浏览器，违背 FR-035。代理方案把问题从「每次渲染 N 次控制面调用」变成「每次图片请求一次数据面读」。
- 代理还顺带统一了本地与生产：**读取路径只有一条**（`fs` 模式读 `.data/media`，`blob` 模式读私有 store），客户端永远只认 `/api/media/...`。

**已知限制（记账，不掩盖）**：
1. 图片字节经 Vercel 函数转发，产生函数带宽与执行时间成本；单图 ≤10MB、每页 ≤6 张，按 M1 规模可接受（重估触发：单页图片体积常态超过 5MB，或带宽成本成为主要开销）。
2. 浏览器缓存 5 分钟内即使成员被移出仍可能看到已缓存的图片（`max-age=300`）；比签名 URL 的 1 小时窗口更短。规格已按此口径写明（FR-029：删除成功后新请求取不到，已打开页面的未过期副本不算违反）。

**Alternatives considered**：
- 公有桶 + 不可猜 URL：能力 URL 一旦转发即永久可读，违背 FR-035。
- 私有桶 + 签名 URL：见上文成本/最小权限两难。
- 图片以 base64 塞进 `article.content`：单篇文档膨胀到数十 MB，`jsonb` 单行重写与列表查询都会被拖垮。
- 自建对象存储（S3/MinIO）：需要额外运维面与凭据管理，与「Vercel + Neon」的现有部署模型不符。

**重估触发**：Vercel Blob 支持「目录前缀级签名」（可一次性覆盖整篇谱文）时，可改回直连以省带宽；或图片量级上升到需要 CDN 直出。

---

## 4. 上传通道：客户端直传 Blob，服务端只签发上传令牌

**Decision**：blob 模式下浏览器用 `@vercel/blob/client` 的 `upload()` 直传私有 store；上传令牌由 `POST /api/blob/upload` 的 `handleUpload` 签发，**只提供 `onBeforeGenerateToken`**（`handleUpload` 的契约就是这样；`getSignedToken` 属于 `handleUploadPresigned`，本期不用）：该回调里先 `getSessionUser()`，再从 `tokenPayload`（`{ orgId, articleId }`）反查 `article` 行拿 `projectId`，校验成员关系与 `article.write`，然后返回 `{ allowedContentTypes: ['image/jpeg','image/png','image/webp'], maximumSizeInBytes: 10 * 1024 * 1024, addRandomSuffix: false, tokenPayload }`；`pathname` 前缀由服务端在回调里拼死为 `articles/<orgId>/<articleId>/`，客户端只能决定文件名主体。

**Rationale**：10MB 同时超过 Server Action 的 1MB 与 Vercel 函数请求体的 4.5MB 上限，所以字节不能过 Server Action，必须客户端直传；令牌的权限范围由服务端在回调里决定，客户端无法自行扩大（FR-035）。

**Alternatives considered**：
- 经 Server Action 中转：10MB 直接超限，不可行。
- 用 `handleUploadPresigned` + `getSignedToken` 自行签发：能力更细，但要自己拼 `operations` 与有效期，本期收益不抵复杂度（重估触发：需要覆盖写、多段上传等能力）。

---

## 5. 本地与 CI 无 Blob 令牌：只有**上传**走文件系统驱动

**Decision**：`lib/article/media/store.ts` 定义 `MediaStore` 接口（`mode` / `read(pathname)` / `delete(pathname)`，契约见 [contracts §3](./contracts/actions-and-permissions.md)），两个实现：

| 实现 | 生效条件 | 读取 | 上传 |
|---|---|---|---|
| `blob-store.ts` | 配置了 `BLOB_READ_WRITE_TOKEN` | `get(pathname, { access: 'private' })` 取流 | 客户端 `upload()` 直传（§4） |
| `fs-store.ts` | **未**配置令牌（本地与 CI） | `fs.readFile('.data/media/' + pathname)` | `POST /api/media/upload`（multipart，写入 `.data/media/`，已在 `.gitignore`） |

选哪个由 `lib/config.ts` 一处判定（F7：只有它能读 `process.env`），客户端通过 RSC props 拿到 `mediaMode: 'blob' | 'fs'`，只影响**上传**走哪条路；读取永远是 `/api/media/...`（§3）。

**Rationale**：CI 与本地不可能拿到 Blob 令牌，但没有上传通道就无法跑 E2E 与手工验证；把差异收敛到「上传」这一处，读取路径与授权逻辑只有一份，测试覆盖的是真实代码。

**重估触发**：CI 需要验证 blob 路径的真实行为（届时用 staging 项目 + 只读令牌，或在 CI 里起 MinIO 兼容层）。

---

## 6. 自动保存与并发：按页提交 + 事务内行锁 + 同页后写覆盖

**Decision**：客户端停止输入 2 秒后提交**当前页**（`saveArticlePageAction`）；服务端在 `withOrgWrite` 事务内 `SELECT … FROM article WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`，替换该页 `doc`、重算 `plain_text`、写 `updated_at`，返回 `{ savedAt, page }` 供客户端回显。并发语义：同页后写覆盖先写（ADR 0002，含同一用户多标签页），不同页互不影响；客户端顶栏在发起后 3 秒内必须收敛为「已保存」或「保存失败」（SC-002），不得长时间停在「保存中」。

**回显与 RSC 边界（避免覆盖正在编辑的文档）**：
- 编辑器页面**只在首次挂载时**用 RSC props 初始化 TipTap 文档；保存成功后**不再用 RSC 数据覆盖**编辑器，只把该页标记为「已保存」，并在该页无未提交改动时用 Action 返回值对齐（FR-017）。
- 保存页、加页、删页、重排页**不调用 `revalidateWholeConsole()`**（它会让整棵 `/dashboard` layout 失效，2 秒一次的自动保存会把服务端快照反复推回编辑器）；只有「新建 / 改标题 / 移分类 / 删除谱文」这类**离开编辑器或改变列表**的操作才 `revalidatePath` 对应的谱文列表路径。

**Rationale**：把「保存」做成高频、幂等、只影响一页的操作；把 revalidate 留给低频的结构性变化。

**Alternatives considered**：
- 整篇提交：每次按键后都要重写全部页，20 页时写放大明显，且两页同时编辑会互相覆盖。
- 保存后整树 revalidate：见上，会与编辑器状态打架。

---

## 7. `plain_text` 派生：只在 `lib/article/doc.ts` 一处实现

**Decision**：`article.plain_text` 是**可空列**（DDL 现状），保存页时由 `derivePlainText(doc)` 写入：按页序收集所有 `text` 节点，页间以 `\n\n` 连接；`articleImage` 不贡献文本。**任何地方不得独立写 `plain_text`**（ADR 0010）。本期不做全文检索（FR-044 后置），该列只为将来的检索保留正确形状。

---

## 8. 列表与分类篇数：SQL 现算，不加冗余列

**Decision**：列表页数用 `jsonb_array_length(article.content -> 'pages')`；分类篇数用

```sql
SELECT a.folder_id, count(*)
FROM article a
JOIN folder f ON f.id = a.folder_id AND f.kind = 1 AND f.deleted_at IS NULL
WHERE a.organization_id = $1 AND a.project_id = $2 AND a.deleted_at IS NULL
GROUP BY a.folder_id
```

（`kind` 在 `folder` 上，`article.kind` 本期恒为 `NULL`，不能拿来过滤。）两者都在 `lib/db/queries/articles.ts` 一处实现，走既有 `idx_article_project`。

**Rationale**：200 篇量级的聚合是毫秒级；冗余列会引入「加页/删页/移动时必须同步」的第二个真相（宪法 V）。

**重估触发**：单项目谱文数升到数千篇且列表变慢（届时按实测加表达式索引或物化计数）。

---

## 9. 权限：**一个串都不改**（FR-036）

**Decision**：谱文读用 `content.read`，写用 `article.write`（零枚举变更，`lib/auth/access-control.ts` 不动）；**谱文分类（`folder.kind = 1`）的新建/重命名/删除继续用 `project.write`**，与谱系、谱书分类一致。`lib/folder/services.ts` 的权限判定**不改**。

**Rationale**：规格 FR-036 明写「本期 MUST NOT 改变既有能力矩阵」，而 `editor` 没有 `project.write`——把分类写权限换成 `article.write` 等于给编辑者新增一项能力，属于规格禁止的范围。代价是编辑者在 UI 上看不到「新建分类」入口（只能选既有分类或「未分类」），用两件事兜住：
1. 新建谱文时若分类树为空，`createArticleAction` 在**同一事务内**自动创建「默认分类」（FR-001 的默认行为，不是新增能力：系统为保证「必有默认分类」做的内部写入，不暴露成用户可选权限）；
2. 分类管理入口按 `hasPermission(role, 'project.write')` 显隐，编辑者看不到，不会出现「点了才被拒」的死路。

**Alternatives considered**：
- 把谱文分类写权限换成 `article.write`：能力矩阵变更，违反 FR-036；若产品确实需要「编辑者整理分类」，应先改规格再改权限，而不是在实现期顺手放权。
- 新增 `article.folder` 权限串：同样改变矩阵，且多一处文档同步。

**重估触发**：产品明确要求编辑者管理谱文分类（需新的 spec 变更 + 权限矩阵与测试同步更新）。

---

## 10. 分类删除的级联：复用既有事务，计数另开只读查询

**Decision**：删除分类继续用 `lib/folder/services.ts:204` 的 `deleteFolderInTransaction`——它已在单个事务内 BFS 收集子树、把 `lineages/articles/books` 的 `folder_id` 置空、软删分类、写活动日志，并返回 `{ deletedFolders, unfiledContent }`。但**现有 `deleteFolderAction` 只把 `unfiledContent` 拼进成功文案、不返回计数**，因此确认框需要的「分类数 / 受影响篇数」改由**只读查询**提供：`getFolderDeletePreview(orgId, folderId)`（RSC 打开确认框前算），`deleteFolderAction` 的签名与返回**保持不变**。

**Rationale**：不为一个确认文案去改既有 Action 的返回契约（会牵动已有调用点与测试）；预览是读，放查询层更合适。

---

## 11. 字体与字号（P2）：`textStyle` + 两个白名单 mark，系统字体

**Decision**：`@tiptap/extension-text-style` 提供 `textStyle` 容器 mark，再挂 `fontFamily` 与 `fontSize` 两个白名单 mark：字体只允许 `宋体 / 黑体 / 楷体`（渲染为 `"Songti SC", SimSun, serif` 这类系统栈，不引入字体文件），字号只允许 `14px / 16px / 19px`（小 / 常规 / 大）。P2 未交付时文档里也不应出现这两个 mark（服务端白名单照样放行，避免将来降级时丢格式）。

**重估触发**：需要「行距 / 段间距 / 首行缩进」等段落级排版（那属于模板套用，另行立项）。

---

## 12. 依赖记账（ADR 0009 §1）

| 依赖 | 版本 | 替换掉的自写代码 | 依据 |
|---|---|---|---|
| `@tiptap/react` `@tiptap/core` `@tiptap/pm` `@tiptap/starter-kit` | 3.x（同一次安装，版本对齐） | contenteditable 选区/撤销/输入法/粘贴清洗（远超 100 行，且属协议细节） | ADR 0010 |
| `@tiptap/extension-text-style` | 3.x | 字体/字号 mark 的 schema 与命令 | ADR 0010 + FR-030 |
| `@tiptap/extension-image` | 3.x | 块级图片节点的 schema/序列化（`extend` 加 `width` 属性并改名 `articleImage`） | FR-025/FR-026 |
| `@vercel/blob` | ≥2.3 | 对象存储上传、私有读取、删除（安全相关，自写 sigv4 不划算） | 新 ADR 0019 |

`package.json` 与 `pnpm-lock.yaml` 由 `pnpm add` 生成；`tests/dependency-pins.test.ts` 只钉 `drizzle-orm` / `drizzle-kit` 次版本，本期不动它们。

---

## 13. 未决项收敛结果

spec.md 的「待确认」**6 行**在本阶段全部有了落点：

| 待确认项 | 落点 |
|---|---|
| 图片存储形态（对象存储/直传/本地） | §3（Vercel Blob 私有 store + 代理读取）+ §4（客户端直传）+ §5（本地 fs 兜底）；容量上限见 FR-025 的 10MB 与 FR-028 的单页 6 张 |
| 「类型」取消后既有 FR-ART-1 如何表述 | 本期不动 `docs/architecture/11-需求与实现状态.md` 的 FR-ART 行，只在实现 PR 里把 FR-ART-1 的「类型」改为「分类」（文档同步清单见 [plan.md](./plan.md) 的 Project Structure › Documentation） |
| 图片/页容量上限是否放宽 | 按 FR-021（100 页）与 FR-028（单页 6 张、单张 10MB）执行——服务端权威校验，客户端预校验 |
| 字体清单与字号档位 | §11（宋/黑/楷 + 3 档字号） |
| 模板套用何时立项 | 独立特性（建议编号 003），本期零交付（FR-042） |
| 页与谱书编目的对应关系 | 页序即成稿顺序，编目只引用整篇谱文（`book_catalog` 不加 `page_id`），本期不改 `book_catalog` |

---

## 14. 离开保护（FR-003 / FR-016）：应用内「先存后走」+ 关闭标签用浏览器原生确认

**Decision**：
1. **应用内离开**（切页、切谱文、返回列表）：一律 `await` 保存所有有改动的页，成功后 `router.push`；失败则停留并提示（FR-003 / FR-016 的前半句）。
2. **关闭标签 / 刷新**：注册 `beforeunload`，存在未保存改动时阻止并让浏览器弹出原生「确定离开？」确认（FR-016 的后半句「给出确认提示，由用户决定是否离开」）。**不做** `keepalive` 上报路由：Server Action 协议不支持 keepalive，新增写路由会破坏「写入一律 Server Action」的仓库约定，而且它的成功率本身不可靠，不如把「确认提示」做扎实。

**Rationale**：把「能保证的」做在应用内（可 await、可失败重试），把「浏览器不给机会」的部分用原生确认兜住，并在 quickstart 里写明验证方法。

**已知限制**：浏览器要求页面有用户交互才允许 `beforeunload` 拦截；若用户在无交互状态下直接关闭，内容可能丢失（与「本期不做离线草稿」的 FR-020 一致）。

**重估触发**：产品要求「关掉标签也不丢内容」（届时需要本地草稿或 Service Worker，属于新特性）。

---

## 15. 地区只读：从云谱空间继承，缺省「中国」

**Decision**：谱文不存地区列；编辑器与列表展示的「地区」= `project.countriesRegions`（`lib/db/schema/project.ts:32`），为空时回退 `'中国'`，只读。**不修改云谱空间设置页的默认值与存储语义**（避免为了谱文展示去改既有设置行为）。

**Rationale**：FR-001 只要求「默认取云谱空间设置（未设置时为『中国』）并只读展示」，派生即可满足；spec「已交付基线」表里「本期补默认『中国』」按此实现，不新增设置项、不改既有表单默认。

**重估触发**：出现「同一云谱空间下不同谱文需要不同地区」的真实诉求（届时需要新增列 + 迁移）。
