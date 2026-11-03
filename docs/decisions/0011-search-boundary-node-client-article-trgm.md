# 0011. 检索边界：人丁与谱文标题搜索留在客户端；trigram 索引随查询一起加

- **状态**：已接受（2026-11-03 修订第 3 条）
- **日期**：2026-10-27
- **可逆性**：双向门
- **取代**：[决策索引](./README.md) 中 ADR-13「检索：`pg_trgm` + ILIKE」这一行——ADR-13 此前只有一行结论，没有文件、没有执行者，按 [ADR-24](./0009-dependency-and-runtime-stance.md) 属于「视为未决策」
- **相关**：[04-数据视图 §10](../architecture/04-数据视图-数据架构.md) · [ADR 0003](./0003-tree-storage-ltree.md) · [ADR 0009（约束必须有执行者）](./0009-dependency-and-runtime-stance.md) · [2026-11-03 Linus 评审 P1-3](../archive/reviews/2026-11-03-linus-architecture-review.md)

## 背景

ADR-13 写的是一句「检索用 `pg_trgm` + ILIKE」。据此 `0001_auth_rls` 建了两个 GIN trigram 索引：`idx_node_search`（`node.full_name`）与 `idx_article_search`（`article.plain_text`）。

但实现从来没有按这句话走：

- `ee41526` 删掉了 `searchNodes` 之后，人丁搜索是 `getNodes` 全量载入 + `matchLineagePerson` 内存匹配（FR-LIN-11）。迁移 [`0013_drop_node_trgm`](../../lib/db/migrations/0013_drop_node_trgm.sql) 删掉了没有读者的 `idx_node_search`。
- 谱文列表落地后，标题过滤同样在已经下发的全量数据上做（`components/article/article-list.tsx`）。`plain_text` 仍由 `derivePlainText` 在保存时写入（ADR 0010），但全仓没有 `ILIKE` / `similarity` / trigram 谓词读它——`idx_article_search` 的消费者仍是零，却在每次保存时付 GIN 维护。这正是 `0013` 删人丁索引时写过的同一类错误。

## 决策

按表分开定边界：

1. **人丁搜索留在客户端**：`getNodes` 全量载入 + `matchLineagePerson` 内存匹配，是当前与将来的实现方式，不改成服务端查询。
2. **`node` 表不建任何 trigram 索引**：迁移 `0013_drop_node_trgm` 删除 `idx_node_search`。
3. **在出现真正的正文检索查询之前，`article` 不保留 trigram 索引**：迁移 [`0025_drop_article_trgm`](../../lib/db/migrations/0025_drop_article_trgm.sql) 删除 `idx_article_search`。`pg_trgm` 扩展保留，正文检索（FR-ART-5 后置项）落地当天只需 `CREATE INDEX`，不必重建扩展。
4. **两列都保留**：`node.full_name` 与 `article.plain_text` 都继续被写/被读（前者进内存匹配，后者由保存路径派生并留给将来的正文检索），只是都不挂 trigram 索引。

这条边界由 `tests/integration/search-boundary.test.ts` 对真实数据库执行：`node` 与 `article` 上均无 `gin_trgm_ops` 索引、`pg_trgm` 扩展仍在。ADR-24 要求规则必须有执行者，这个测试就是执行者。

## 后果

### 正面

- 去掉两处**每次写都要付**、却服务零查询的 GIN 写放大（`node.full_name` 与 `article.plain_text`）。
- 检索决策从「一行没执行者的结论」变成有测试守住的实际边界；不再有「看起来在用」的孤儿索引。

### 负面（必须诚实写）

- **`search-boundary.test.ts` 会拦住「先加索引、后补查询」**：要加服务端 trigram 查询，必须同一改动里改 ADR、加索引、放宽断言。
- 迁移不可回滚：删索引没有 down 迁移。要恢复须新迁移重建。
- 客户端全量匹配随单谱系人丁数 / 单项目谱文数线性变慢；当前规模下没问题，但没有服务端兜底。

## 放弃的方案

| 方案 | 为什么不够好 |
|---|---|
| 保留 `idx_article_search`，等正文检索再接线 | 谱文读写已落地，索引消费者仍为零；每次保存白付 GIN。与当初保留 `idx_node_search` 是同一错误 |
| 连 `pg_trgm` 一起删 | 正文检索开工时要重写 `CREATE EXTENSION`；扩展几乎零成本，留着只换一次 `CREATE INDEX` |
| 现在就实现正文 `ILIKE` / trigram 查询 | FR-ART-5 正文检索仍是后置项；列表标题过滤已满足本期。为消索引而提前做检索，是范围膨胀 |
| 把人丁搜索改成服务端 `ILIKE`，保留索引 | 画布即时过滤与定位需要全量内存索引，服务端查询反而要重做交互 |

## 重估触发条件

- **单谱系人丁量超过约 5000（保守阈值）**，或 `getNodes` 全量载入不再可行；
- `node` 单表超过 500 万行，或检索 p95 超过 300ms；
- 出现需要跨谱系 / 全组织的人丁检索需求；
- **开工实现谱文正文检索（FR-ART-5 后置项）**。

出现以上任一信号时：**先改本 ADR**，再在同一个改动里同时加回对应索引与服务端查询，并放宽 `tests/integration/search-boundary.test.ts` 的断言。本 ADR 定义的反模式只有两种：**只加服务端查询而不把索引与测试断言一起改回来**；**只加索引而没有消费者查询**（`idx_node_search` / `idx_article_search` 此前的处境）。先加查询、看见它需要索引，再把索引与断言一起补上，是正确路径，不是反模式。
