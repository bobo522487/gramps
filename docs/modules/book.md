# 谱书（Book）

> 占位文档：谱书三表已落库，但当前没有写入口。等编辑、编目或导出链路落地后，再把本文扩充为完整模块导读。

## 1. 现状

| 表 | 用途 | 写入口 |
| --- | --- | --- |
| `book` | 一部谱书的元数据 | 无 |
| `book_catalog` | ltree 编目树，引用 `article` / `lineage` | 无 |
| `book_export` | 库外导出制品的元数据（URI / checksum / cutoff） | 无 |

页面上 `/dashboard/project/[projectRef]/books` 只有空状态。

## 2. 边界

- 库内书是**动态引用**：`book_catalog` 指向当前谱系与谱文，内容一改，所有引用它的书同时变。
- 成书成为历史制品发生在**导出**那一刻；`book_export` 只登记元数据，不存正文。
- 不建库内版本快照、不建版本 diff、不建 GC。

## 3. 未来要补的链路

1. 谱书 CRUD 与编目树编辑；
2. 按 `book_catalog.path` 渲染并导出 PDF / 排版文件；
3. 导出记录写入 `book_export`，制品存对象存储。

排期与状态见 [roadmap.md](../roadmap.md)，数据结构见 [data-model.md](../data-model.md)。
