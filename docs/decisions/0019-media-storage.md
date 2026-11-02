# 0019. 谱文图片存储：Vercel Blob 私有桶 + 服务端代理读取，本地走文件系统兜底

- **状态**：已接受
- **日期**：2026-11-02
- **可逆性**：单向门——图片字节一旦按某种前缀规则落进某个存储，换存储要么搬数据、要么保留双读；一旦有用户在浏览器里存过 URL，读取路径也不能随意改

## 背景

[谱文规格 002](../../specs/002-article-authoring/spec.md) 把「插入一张老照片」定为 P0（FR-025..FR-029），而仓库现状是**零媒体能力**：[04-数据视图-数据架构](../architecture/04-数据视图-数据架构.md) 写着「媒体字节｜无对象存储｜没有上传功能」，[06-部署视图-部署架构](../architecture/06-部署视图-部署架构.md) 的部署清单里没有对象存储，全仓库 `upload|media` 相关代码 0 命中。也就是说 P0 一落地，就必须同时决定：字节放哪、谁能读、上传走哪条通道、本地开发怎么验。

三个约束把选择空间压得很小：

1. **组织隔离是宪法级要求**（[AGENTS.md](../../AGENTS.md) §5.4、原则 I）。谱文正文里的人丁像、老宅照片属敏感家族资料，公开可读的 URL 等于把隔离押在「路径猜不到」上。
2. **零后台任务是原则**（[ADR 0005](./0005-zero-background-jobs.md)、[ADR 0009 §4](./0009-dependency-and-runtime-stance.md)）。任何「异步转码 / 定时清理」的方案都不合格。
3. **部署形态是 Vercel + Neon**（[06-部署视图-部署架构](../architecture/06-部署视图-部署架构.md)）。Server Action 的请求体上限 1 MB、Vercel 函数请求体上限 4.5 MB，而规格允许单张 10 MB；本地开发只有 Docker 里的 PostgreSQL，没有 minio 之类的服务。

## 决策

- **字节存 Vercel Blob 私有存储（`access: 'private'`）**，路径规则 `articles/<orgId>/<articleId>/<uuid>.<ext>`——`orgId` 进路径，越权判定在存储层就有一次结构性屏障。
- **文档里只存 pathname，不存完整 URL**。`article.content` 的图片节点记 `source: "articles/…/x.jpg"` 与显示宽度档位；读取 URL 每次现签，写进库就等于写了个会过期的东西。
- **读取走服务端代理**：`GET /api/media/<pathname>` 在校验「会话有效 + 该谱文的组织成员 + `content.read`」之后，用 `@vercel/blob` 的 `get(pathname, { token, type: 'blob' })` 取字节并透传，附 `Cache-Control: private, max-age=300`。**放弃逐 pathname 签名 URL**（`issueSignedToken` 是控制面调用， pathname 只支持精确串或 `*`：精确串意味着一屏 40 张图 = 40 次签发往返，直接顶穿 SC-003 的切页 <300 ms；`*` 又等于把最小权限退化成整桶可读）。
- **上传走客户端直传**：`POST /api/blob/upload` 用 `handleUpload({ onBeforeGenerateToken })`，在生成令牌前校验会话、成员、`article.write`、MIME（`image/jpeg|png|webp`）与 10 MB 上限，并把 `{ orgId, articleId }` 钉进 token payload；字节不经过 Server Action，绕开 1 MB / 4.5 MB 两道墙。
- **本地兜底**：没有 `BLOB_READ_WRITE_TOKEN` 时（本地与 CI 的默认），同一个接口形状落到文件系统驱动，写 `.data/media/`，读取仍是同一个代理路由。由 `lib/config.ts` 单点决定用哪个（原则 F7：只有它能读 `process.env`），业务代码只看 `getMediaStore()`。判定**只看令牌、不看平台**：开发机补上生产令牌即可真机验证 Blob 通道（守卫测试 `tests/integration/media-blob.test.ts`，无令牌时 skip）。
- **删除语义**：软删谱文保留字节（与 [ADR 0004](./0004-soft-delete-forever.md) 一致）；硬删谱文或整篇替换图片时，**事务提交后**删字节，失败只记日志不回头滚事务——数据库已不可见的内容不能被回滚成"可见但文件没了"。

## 后果

- **正**：组织隔离由服务端每次读取判定，不依赖 URL 保密；10 MB 图片不占 Server Action 与函数请求体；本地无凭证也能跑通完整链路（fs 驱动）；零后台任务，没有新增常驻进程。
- **负**：代理把图片字节流量过一遍函数（`max-age=300` 只能压掉一部分）；**没有生命周期回收**，孤儿字节（上传成功但页保存失败、删页与保存竞争）会永久堆积——本期接受，因为它不影响正确性，只影响成本，且触发条件明确（见下）；`.data/media/` 是新增的本地落盘目录，需要进 `.gitignore`。
- **中**：`@vercel/blob` 是新的运行期依赖，按 [ADR 0009 §1](./0009-dependency-and-runtime-stance.md) 的口径它替换的是「自写对象存储客户端 + 签名与鉴权代码」——记账见 [research.md §12](../../specs/002-article-authoring/research.md)；本地 fs 驱动是自写代码，约 60 行，不上生产。

## 放弃的方案

- **公有 Blob 桶**：读取最省，但「知道 URL 即可读」把隔离降级成 obscurity，直接违反原则 I，否决。
- **逐 pathname 签名 URL**：成本与安全不可兼得（40 张图 40 次控制面往返；改成 `*` 又退化成整桶），否决，改为服务端代理。
- **base64 内嵌进 `article.content`**：零新依赖很诱人，但正文 JSON 被字节撑大后每次自动保存都要整树搬运，SC-003（切页 <300 ms、保存 p95 <800 ms）与 SC-010（200 篇列表 <1 s）双双不可能，否决。
- **Neon 里存 `bytea`**：不加依赖，但把最大的一等公民塞进行存，`SELECT` 不带列裁剪就会拖垮列表查询，且备份/迁移成本直接跟着图片涨，否决。
- **自建 minio / 挂 NAS**：多一个常驻服务，违反零后台任务与当前「一台 Next + 一个 PG」的部署形状，否决。

## 重估触发条件

1. **代理带宽成为账单上的可见项**，或图片读取成为 p95 的主要构成：考虑改用 CDN / 带签名的短时 URL 批量签发（届时 Blob 的批量签名 API 若成熟，可推翻本 ADR 的读取形态）。
2. **孤儿字节可观测**（用量报表或简单的「引用计数巡检」查询上线）且非零：补回收任务，需要为 [ADR 0005](./0005-zero-background-jobs.md) 的「按请求执行的函数」通道做一次独立评审。
3. **出现图片以外的媒体需求**（音频族训、扫描件 PDF）：路径规则与 MIME 白名单要重定，考虑独立媒体表而不是 `article.content` 内嵌。
4. **多租户体量上来（单组织谱书 ≤200 的口径被突破）** 或需要按组织隔离凭证 / 计费：从单桶前缀改为每桶一凭证，读取代理的鉴权分支也要重写。
