# 0011. 检索边界：人丁搜索留在客户端，trigram 只给谱文

- **状态**：已接受
- **日期**：2026-10-27
- **可逆性**：双向门
- **取代**：[决策索引](./README.md) 中 ADR-13「检索：`pg_trgm` + ILIKE」这一行——ADR-13 此前只有一行结论，没有文件、没有执行者，按 [ADR-24](./0009-dependency-and-runtime-stance.md) 属于「视为未决策」
- **相关**：[data-model §10](../data-model.md) · [05-data §8.5](../architecture/05-data.md) · [ADR 0003](./0003-tree-storage-ltree.md) · [ADR 0009（约束必须有执行者）](./0009-dependency-and-runtime-stance.md)

## 背景

ADR-13 写的是一句「检索用 `pg_trgm` + ILIKE」。据此 `0001_auth_rls` 建了两个 GIN trigram 索引：`idx_node_search`（`node.full_name`）与 `idx_article_search`（`article.plain_text`）。

但实现从来没有按这句话走。`ee41526` 删掉了 `searchNodes`（唯一使用 trigram 运算符的查询）之后：

- 全仓 `grep -rn "searchNodes" lib app components tests` 为空，`lib/db/queries`、`lib/lineage` 里也没有任何 `ILIKE` / `similarity` / trigram 谓词——`idx_node_search` 的消费者是零；
- 人丁搜索实际是 `getNodes` 按谱系全量载入，再由 `components/lineage/derived.ts` 的 `matchLineagePerson` 在内存里对 `fullName`、`name`、`courtesy`、`namePrefix`、`birthText`、`deathText`、`burialPlace`、`biography` 做子串匹配——它已满足 FR-LIN-11，有单测（`tests/lineage-canvas-layout.test.ts`），画布即时过滤与「定位到节点」都依赖它。

也就是说：**客户端搜索是当前实现的事实，不是待办。** 索引还在，只因为没人删它。

## 决策

按表分开定边界：

1. **人丁搜索留在客户端**：`getNodes` 全量载入 + `matchLineagePerson` 内存匹配，是当前与将来的实现方式，不改成服务端查询。
2. **`node` 表不建任何 trigram 索引**：迁移 [`0013_drop_node_trgm`](../../lib/db/migrations/0013_drop_node_trgm.sql) 删除 `idx_node_search`。
3. **`pg_trgm` 扩展与 `idx_article_search` 保留**：FR-ART-5（谱文全文检索）需要它们，谱文实现那天直接用，不重建扩展。
4. **两列都保留**：`node.full_name` 与 `article.plain_text` 都被读（前者进内存匹配，后者是谱文检索列），只是不再都给它们建 trigram 索引。

这条边界由 `tests/integration/search-boundary.test.ts` 对真实数据库执行：`node` 上无 `gin_trgm_ops` 索引、`article` 上恰为 `['idx_article_search']`、扩展仍在。ADR-24 要求规则必须有执行者，这个测试就是执行者。

## 后果

### 正面

- 去掉一处**每次写人丁都要付**的写放大：GIN 索引在 `node.full_name` 每次 `INSERT` / `UPDATE` 时都要做 trigram 分解。`node` 是最热的写表（录入、改名、移动都会写），索引却服务零查询。
- 省下一次只增不减的索引维护与磁盘占用；`INSERT` 路径少一个索引，同时少一个可能失败的对象。
- 检索这条决策从「一行没执行者的结论」变成一个有测试守住的实际边界；人和文档都不用再猜人丁搜索走哪条路。

### 负面（必须诚实写）

- **新增的 `search-boundary.test.ts` 对真实库断言这条边界；一旦有人在服务端再加 trigram 查询，测试会红** ——这是刻意的，但也意味着「临时查一下」也会被拦，要连同 ADR 一起改。
- 迁移不可回滚：删索引没有 down 迁移。要恢复须重写迁移（见「重估触发条件」），索引重建代价随 `node` 行数增长。
- 客户端全量匹配随单谱系人丁数线性变慢；当前规模下没问题，但没有服务端兜底。

### 中性

- `article` 侧不受影响：`idx_article_search` 与 `pg_trgm` 原样保留，谱文实现时零迁移。
- 数据库层只剩一个 trigram 索引，每个索引都有对应的查询方；不再有「看起来在用」的孤儿索引。

## 放弃的方案

| 方案 | 为什么不够好 |
|---|---|
| 保留 `idx_node_search`，等谱文/服务端检索再考虑 | 索引只在有人写 trigram 查询时才有用；零消费者期间每次写人丁都白付 GIN 维护。留着等于把成本留给一个没有排期的需求 |
| 连 `pg_trgm` 与 `idx_article_search` 一起删 | FR-ART-5 是已承诺需求；扩展一删 `idx_article_search` 立刻失效，谱文实现时要重写迁移——为了「干净」付双倍代价 |
| 把人丁搜索改成服务端 `ILIKE`，保留索引 | 当前没有分页/虚拟化的服务端检索需求；画布的即时过滤与定位需要全量内存索引，服务端查询反而要重做交互 |
| 什么都不做，只改文档 | ADR-13 与实现继续错位，索引成本继续存在；下一个读文档的人会以为人丁搜索走 `pg_trgm` |

## 重估触发条件

- **单谱系人丁量超过约 5000**（当前全量载入与内存匹配的产品上限）；或 `getNodes` 全量载入不再可行；
- `node` 单表超过 500 万行，或检索 p95 超过 300ms（[data-model §10.1](../data-model.md) 已给出的外部索引触发线）；
- 出现需要跨谱系 / 全组织的人丁检索需求。

出现以上任一信号时：**先改本 ADR**，再在同一个改动里同时加回 `idx_node_search` 与服务端查询，并放宽 `tests/integration/search-boundary.test.ts` 对 `node` 的断言。只加索引不加查询、或只加查询不改断言，都是本 ADR 定义的反模式。
