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
- **读取走签名 URL 直连，授权仍在我们手里**：`GET /api/media/<pathname>` 校验「会话有效 + 该谱文的组织成员 + 谱文未软删」之后，回 `302` + `Location: <私有桶签名 URL>`（`Cache-Control: no-store`），字节由存储域名直接发给浏览器。签名用 `issueSignedToken({ operations: ['get' ] })` + `presignUrl({ operation: 'get', pathname, access: 'private' })`：**delegation 令牌按进程缓存**（默认 1 小时有效，提前 5 分钟换新、并发只打一次控制面），`presignUrl` 本身是本地 HMAC、零网络，所以 40 张图只有「换令牌」那一次往返；每张 URL 单独签、有效期压到 5 分钟。`clientSigningToken` 只在服务端用于签名，绝不出现在响应里。**放弃每请求代传字节**：官方把「函数当 CDN」列为成本反模式（函数出网流量 BDT 约为纯存储出口的 3 倍，还要在内存里把整张图拼起来）。本地兜底驱动没有可直连的域名，仍由路由自己发字节。
- **上传走客户端直传**：`POST /api/blob/upload` 用 `handleUpload({ onBeforeGenerateToken })`，在生成令牌前校验会话、成员、`article.write`、MIME（`image/jpeg|png|webp`）与 10 MB 上限，并把 `{ orgId, articleId }` 钉进 token payload；字节不经过 Server Action，绕开 1 MB / 4.5 MB 两道墙。
- **本地兜底**：没有 `BLOB_READ_WRITE_TOKEN` 时（本地与 CI 的默认），同一个接口形状落到文件系统驱动，写 `.data/media/`，读取仍是同一个代理路由。由 `lib/config.ts` 单点决定用哪个（原则 F7：只有它能读 `process.env`），业务代码只看 `getMediaStore()`。判定**只看令牌、不看平台**：开发机补上生产令牌即可真机验证 Blob 通道（守卫测试 `tests/integration/media-blob.test.ts`，无令牌时 skip）。
- **删除语义**：软删谱文保留字节（与 [ADR 0004](./0004-soft-delete-forever.md) 一致）；硬删谱文或整篇替换图片时，**事务提交后**删字节，失败只记日志不回头滚事务——数据库已不可见的内容不能被回滚成"可见但文件没了"。

## 后果

- **正**：组织隔离由服务端每次读取判定，不依赖 URL 保密；10 MB 图片不占 Server Action 与函数请求体；本地无凭证也能跑通完整链路（fs 驱动）；零后台任务，没有新增常驻进程。
- **负**：读取多一次 302 往返；已签出的 URL 在其 5 分钟有效期内不可主动吊销，删除后**已打开页面**里尚未过期的那张仍可能加载得到（新的读取一律重新过授权，规格 FR-029 已按此口径写明）；**没有生命周期回收**，孤儿字节（上传成功但页保存失败、删页与保存竞争）会永久堆积——本期接受，因为它不影响正确性，只影响成本，且触发条件明确（见下）；`.data/media/` 是新增的本地落盘目录，需要进 `.gitignore`。
- **中**：`@vercel/blob` 是新的运行期依赖，按 [ADR 0009 §1](./0009-dependency-and-runtime-stance.md) 的口径它替换的是「自写对象存储客户端 + 签名与鉴权代码」——记账见 [research.md §12](../../specs/002-article-authoring/research.md)；本地 fs 驱动是自写代码，约 60 行，不上生产。

## 放弃的方案

- **公有 Blob 桶**：读取最省，但「知道 URL 即可读」把隔离降级成 obscurity，直接违反原则 I，否决。
- **逐 pathname 走控制面签发**（每张图一次 `issueSignedToken`）：40 张图 = 40 次往返，直接打穿 SC-003，否决。留空的不是「签名 URL」本身：只取**一次**整店只读 delegation（服务端内存缓存 1 小时），再用本地 HMAC 的 `presignUrl` 逐 pathname 签 5 分钟只读 URL，`clientSigningToken` 不出服务端，落进浏览器的只是一张图的短时权限。
- **base64 内嵌进 `article.content`**：零新依赖很诱人，但正文 JSON 被字节撑大后每次自动保存都要整树搬运，SC-003（切页 <300 ms、保存 p95 <800 ms）与 SC-010（200 篇列表 <1 s）双双不可能，否决。
- **Neon 里存 `bytea`**：不加依赖，但把最大的一等公民塞进行存，`SELECT` 不带列裁剪就会拖垮列表查询，且备份/迁移成本直接跟着图片涨，否决。
- **自建 minio / 挂 NAS**：多一个常驻服务，违反零后台任务与当前「一台 Next + 一个 PG」的部署形状，否决。

## 重估触发条件

1. **需要秒级吊销**（把 5 分钟窗口压到更短，或成员被移出后立刻切断已打开的页面）：签名 URL 做不到主动吊销，届时回到「函数代传字节」并在路由上实时判定，或改为短轮询的重签接口。
2. **孤儿字节可观测**（用量报表或简单的「引用计数巡检」查询上线）且非零：补回收任务，需要为 [ADR 0005](./0005-zero-background-jobs.md) 的「按请求执行的函数」通道做一次独立评审。
3. **出现图片以外的媒体需求**（音频族训、扫描件 PDF）：路径规则与 MIME 白名单要重定，考虑独立媒体表而不是 `article.content` 内嵌。
4. **多租户体量上来（单组织谱书 ≤200 的口径被突破）** 或需要按组织隔离凭证 / 计费：从单桶前缀改为每桶一凭证，读取授权与签名的分支都要重写（届时整店 delegation 也应换成每组织一令牌）。
