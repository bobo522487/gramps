-- 创建幂等键（风险登记簿 R31）：node.request_id + 组织内部分唯一索引。
--
-- 双击「添加子女」、慢网重试、Server Action 被重放，过去都会静默多插一行：
-- `node` 上没有任何业务唯一索引（uk_node_organization_id / uk_node_org_lineage_id
-- 只服务复合外键），创建入参里也没有幂等键。现在每个创建类 Action 必须带一个
-- 客户端生成的 uuid（一次提交意图一个），写入主那一行；同组织内同键只能留下
-- 一行未删人丁，重放与并发双飞都由 lib/lineage/node-create-services.ts 兜回
-- 已有那一行，而不是报 409。
--
-- 索引列序 organization_id 在前：与 RLS 及所有 node 查询携带的前缀一致
-- （0014_spouse_sort_index 的同一口径）。部分条件排除软删行，删掉之后同一键
-- 可以再录一次新的人丁。
--
-- 同事务共创的配偶行**不**写 request_id——它会和血亲撞同一条唯一索引；重放时
-- 按 spouse_of_id 找回。历史行 request_id 为 NULL，部分唯一索引不约束 NULL，
-- 所以本迁移在空库与既有库上都能一次执行，不需要数据回填。
ALTER TABLE "node" ADD COLUMN "request_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_node_org_request_id" ON "node" USING btree ("organization_id","request_id") WHERE "node"."request_id" is not null and "node"."deleted_at" is null;
