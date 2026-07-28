# CMP-API-FORM-HTTP

## 范围与结论

- 已实现 `apps/api/src/platform-http/form-schema-http.ts`，仅暴露契约中的精确发布读取与提交值校验。
- 已实现同名单元测试；未修改 composition、main、factory、package、lockfile、契约或生成物。
- 适配器是框架无关的值对象边界。后续 Nest 接线必须把原始 UTF-8 body 以 `string` 或 `Uint8Array` 传入，不能只传经过 JSON middleware 解析的对象，否则无法证明 256 KiB 的编码字节限制。

## 已知事实

- HTTP 契约路径仅为 `GET /form-definitions/{definitionId}/releases/{releaseVersion}` 与 `POST .../validate`。
- validate 的完整编码 body 上限为 262144 字节；`data` 根深度为 1，嵌套对象/数组最大深度 32；对象、数组、标量节点合计最多 10000（含 data 根）。三项限制均先于可信授权链和模块服务调用。
- 上层可信授权链负责 BFF session、organization workforce context 和对应静态 HTTP permission；返回最小 `actorId`、`workforcePersonId`、可选 `assignmentId` 与可信 `traceId`。
- 模块公共入口只调用 `getRelease` 与 `validateSubmission`；未开放草稿、发布或启停接口。

## 允许的假设

- Controller 能取得原始 request body，并把不透明 session credential 与服务端确定的 `at` 交给授权适配函数。
- 上层授权函数仅在 session、有效人员上下文及 `platform.form-schema.form-release:{read|validate}` 静态权限全部通过后返回可信 context。
- `actorId` 使用模块已接受的稳定引用格式；适配器不从客户端 body、path 或 Keycloak issuer/subject 组合反推 Actor。

## 禁止的假设

- 不信任客户端提供的 Actor、workforce person、assignment 或 Trace。
- 不把客户端校验视为权威，不持久化 submitted data，不推断任何领域不变量。
- 不增加 current/latest 版本解析、管理、草稿、发布、启停或外部 audience 接口。
- 不允许 percent-encoded path、query/hash、非规范前导零版本或宽松 JSON request envelope。

## 非目标

- 本任务不负责把适配器注册到 Nest Controller 或共享 composition。
- 不变更 OpenAPI、权限目录、模块服务、数据库或遥测实现。
- 不定义 CRM 表单、字段、角色或业务规则。

## 稳定行为

- 路径/方法不匹配分别返回稳定 404/405；POST 仅接受 `application/json`（可带 UTF-8 charset），body 必须恰为 `{ "data": ... }`。
- transport malformed 为 400，超字节/深度/节点为 413，未认证为 401，授权拒绝为 403，精确版本缺失为 404，已注册 schema 编译拒绝为 422，依赖/未知失败为 503。
- 响应不回显 credential、请求 body、内部异常或授权细节；成功响应和取得可信 trace 后的响应带 `X-Trace-Id`，并统一 `Cache-Control: no-store`。

## 八维自审

1. **授权**：所有 contract/path/body/limit 校验先于 `authorize`；Actor 只取可信授权输出；模块仍执行自身资源授权，形成分层失败关闭。
2. **审计**：本适配器不伪造审计事实；读取/校验的模块授权审计边界保持不变。HTTP 层不记录 body 或 credential。
3. **幂等、重试与超时**：两个操作均只读、无 idempotency key；适配器不自动重试。超时由后续应用接线沿用统一请求/依赖策略，503 保持可安全重试语义但不承诺成功。
4. **事务**：HTTP 层无写入、无事务句柄，也未跨模块查询；事务边界不适用。
5. **迁移**：无 schema/数据库变更，不需要迁移或回滚 SQL；删除新增适配器与测试即可回滚。
6. **可观测性与隐私**：只传播可信 trace；稳定错误不泄露异常、payload、session 或人员内容。实际日志/指标由共享 Controller/observability 接线负责，且不得记录 body。
7. **契约与测试**：25 项专项测试覆盖精确路径/版本/方法、JSON/media type、UTF-8 字节、深度边界、节点边界、调用顺序、Actor/permission 映射及稳定错误映射；实现文件语句/行/函数覆盖率 100%。
8. **向后兼容**：仅新增未接线适配器，无现有 export/route 行为变化；共享接线时不得扩大 audience 或加入未审契约路由。

## 验证证据

- `pnpm --filter @ai-crm/api exec eslint src/platform-http/form-schema-http.ts src/platform-http/form-schema-http.test.ts --max-warnings 0`：通过。
- `pnpm --filter @ai-crm/api exec vitest run --config ../../vitest.config.ts src/platform-http/form-schema-http.test.ts`：25/25 通过；实现文件语句/行/函数 100%。
- 专项 strict TypeScript 编译（`--strict --exactOptionalPropertyTypes --module NodeNext`，仅实现与测试）：通过。
- 整包 `pnpm --filter @ai-crm/api typecheck` 当前被并行中的 `src/platform-http/file-center-http.test.ts:120` 阻塞；本任务此前在该并行文件出现错误前通过整包 typecheck，且后续会补充专项 TypeScript 检查。该文件不在本任务所有权内，未修改。

## 未决接线事项

- 主线程需决定 Nest 原始 body 捕获方式，并将 `createFormSchemaHttpAdapter` 接入共享 composition/controller/export。
- 主线程需把统一 Trace 创建/提取结果放入可信授权 context；不得直接采用任意客户端 `X-Trace-Id`。

## 集成复审闭环

- Nest 使用应用自管 JSON Parser，保留原始字节并以 262144 字节为上限；真实 HTTP 回归证明 120 KiB 请求进入 Adapter、超限请求在进入 Adapter 前返回 413。
- 无正文 GET 允许客户端附带 Content-Type；同一入站 W3C Trace 贯穿授权记录、模块调用和响应。
- 生产 Form 查询绑定仍是 required unhealthy Readiness 依赖；未开放 Draft/Publish/Activation 控制面。
