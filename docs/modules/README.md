# 模块导读（Modules）

> **回答什么问题**：每个领域的写入入口、领域模型、前端链路和已知限制落在哪。
> **读者**：功能开发 · 代码评审 · AI Agent　**长度上限**：1 页
> **不写什么**：系统分层（`docs/architecture.md`）、表与不变量（`docs/data-model.md`）、接口与错误码（`docs/api.md`、`docs/contracts/`）、决策理由（`docs/adr/`）。

| 模块 | 文档 | 覆盖 |
| --- | --- | --- |
| 认证 / 组织 / 项目 / 分类 | [auth-org-project.md](auth-org-project.md) | 会话、RBAC、邀请、组织生命周期、project/folder |
| 谱系 | [lineage.md](lineage.md) | person/node 分离、ltree 路径、画布、检视器 |
| 谱文与媒体 | [article-media.md](article-media.md) | 分页文档、自动保存、TipTap、图片上传与读取 |
| 谱书 | [book.md](book.md) | 编目树与导出占位（暂无写入口） |
