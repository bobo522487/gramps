# 仓库入口

> **回答什么问题**：规则正文在哪、改东西该读哪份文档。
> **读者**：AI Agent · 新人 · 全员　**长度上限**：1 页
> **不写什么**：原则正文（`.specify/memory/constitution.md`）、可执行流程与「改什么 → 读什么」对照表（`CONTRIBUTING.md`）、任何产品 / 架构 / 数据 / 阈值细节（`docs/`）。

本文件**只是入口指针**：指路，不承载规则。原则正文唯一在 `.specify/memory/constitution.md`（编号 `I`–`V`），其余文档只引用编号，不复制第二份。

## 读的顺序

1. `README.md` — 项目是什么、怎么跑起来、文档地图
2. `.specify/memory/constitution.md` — 哪些事永远不能做
3. `CONTRIBUTING.md` — 改一处要跟改哪些文档、怎么提 PR、什么算完成
4. `docs/glossary.md` — 领域语言（写 spec 前必读）
5. 按任务取 `docs/` 对应文档；「改什么 → 读什么」的对照表只在 `CONTRIBUTING.md` §1

## 不要做的事

- 不要在本文件写规则、命令、表结构、版本号或术语定义：它们各有唯一真相源，抄一份就会漂移。
- 不要引用已下线的旧文档路径；`docs/` 下只有当前这套文档，没有归档层。
- 原则增删走 PR + 全员评审（`CONTRIBUTING.md` §1），不直接改本文件。
