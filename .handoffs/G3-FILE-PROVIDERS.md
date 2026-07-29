# G3-FILE-PROVIDERS — COS / ClamAV 生产适配边界

状态：实现完成；真实测试 Bucket 验收与生产组合接线待外部资料/Integration Owner

## Known facts

- ADR-0012 已确认生产二进制使用私有腾讯云 COS，本地文件系统仅用于开发/测试，恶意文件扫描使用 ClamAV。
- `file-center` 已有供应商中立 `StorageAdapter` / `MalwareScanner` Port，且 Local Adapter 已运行公共 StorageAdapter 契约门。
- ADR-0023 要求生产 Secret 只通过 typed `*_FILE` 和最小只读单文件挂载进入容器；缺失、空值或不可读必须失败关闭。
- 首个真实测试 Bucket 的 Region、Bucket 名、CAM 子账号、凭据文件和批准人尚未出现在仓库中，因此本工作区不能产生真实 COS 通过证据。
- Host B、RabbitMQ/DB Secret、消费者拓扑和完整 Worker 组合由并行 Worker 线独占，本任务不修改生产 Compose 或 AsyncAPI。

## Allowed assumptions

- 腾讯云官方 `cos-nodejs-sdk-v5` 可作为组合根中的具体 Provider SDK；业务中立 Port 和文件中心公开契约不出现 SDK 类型。
- COS Bucket/Region 是非秘密路由配置；SecretId/SecretKey 是环境、服务、用途独立的文件式 Secret。
- ClamAV 与 Worker 位于批准的私有网络边界，使用 clamd `INSTREAM` 协议；跨主机明文链路仍需单独安全评审。
- 真实测试 Bucket 契约执行只能由显式 `AI_CRM_COS_CONFORMANCE_ENABLED=true` 开启，并复用生产 typed 配置读取路径。

## Forbidden assumptions

- 不伪造测试 Bucket、Region、CAM 策略、Secret、真实契约通过结果、生产容量或告警阈值。
- 不把 Local Adapter 结果、mock COS 单测或“SDK 能实例化”称为真实 COS Ready 证据。
- 不把 ETag 当内容摘要，不返回 Bucket/Object Key/Secret/永久 URL，不记录 Provider payload。
- 不因 ClamAV 不可用、超时或返回无法扫描而放行文件。
- 不修改 Host B、RabbitMQ topology/AsyncAPI，或自行启用消费者。

## Non-goals

- 不定义 CRM 文件类型、大小/扩展名政策、保留期、角色或业务关联规则。
- 不创建真实 Bucket、CAM 用户/策略、Secret 文件或生产账号。
- 不证明 COS CORS、SSE/KMS、生命周期、告警和恢复演练已完成。
- 不承担 API/Worker 完整生产组合、Compose Secret 挂载或消费者启用。

## Implementation

- `file-provider-config.ts`：typed ClamAV host/port/timeout、COS Bucket/Region/timeout，以及分离的 `AI_CRM_COS_SECRET_ID_FILE` / `AI_CRM_COS_SECRET_KEY_FILE`；缺失、格式不合法或两文件内容复用均失败关闭。
- `file-center/provider/tencent-cos`：显式 Provider 子入口承载官方 COS SDK、强制 HTTPS/严格 TLS、最长一小时短时签名、不可猜测 handle 校验、Bucket health、HEAD/Range read/delete/quarantine copy-delete，以及稳定 `FileCenterError` 失败分类；API/Worker 各自在组合根注入，不形成 apps 间依赖。
- `clamav-scanner.ts`：有界 clamd INSTREAM 调用；clean、malicious、unscannable 分离，连接/超时/协议异常统一为可重试 scan unavailable，超出 scan ceiling 在连接前拒绝。
- `cos-storage-adapter.integration.test.ts`：真实测试 Bucket opt-in 契约门，直接调用 `@ai-crm/platform-file-center/testing/storage-adapter-conformance` 的同一 harness；测试使用随机业务中立 handle，并在 fixture 结束时清理源对象与隔离对象。
- `file-center` 仅新增 test-only subpath export，不把 COS SDK 或 Provider DTO 加入生产公共入口。

## Compose integration manifest（供 Worker 线接入）

非 Secret：

- `AI_CRM_CLAMAV_HOST`
- `AI_CRM_CLAMAV_PORT`
- `AI_CRM_CLAMAV_TIMEOUT_MS`
- `AI_CRM_COS_BUCKET`
- `AI_CRM_COS_REGION`
- `AI_CRM_COS_TIMEOUT_MS`

API 还必须显式提供（无仓库默认生产值）：

- `AI_CRM_FILE_DOWNLOAD_GRANT_TTL_MS`
- `AI_CRM_FILE_MAXIMUM_SCAN_BYTES`
- `AI_CRM_FILE_MAXIMUM_UPLOAD_BYTES`
- `AI_CRM_FILE_UPLOAD_SESSION_TTL_MS`

只读单文件 Secret：

- `AI_CRM_COS_SECRET_ID_FILE=/run/secrets/<service-cos-secret-id>`
- `AI_CRM_COS_SECRET_KEY_FILE=/run/secrets/<service-cos-secret-key>`

API 与 Worker 各自的两份 COS Secret 必须为服务/环境/用途专用且分别挂载；API 与 Worker 不得互相复用，也不得复用备份账号、浏览器临时凭据或其他服务账号。CAM 最小动作清单和 Bucket resource scope 必须由测试/生产 Bucket Owner 依据实际上传、HEAD、GET、copy quarantine、delete 和签名路径审批，仓库不猜策略 JSON。

## Failure classification

- COS 404：inspect 返回 absent；读取/下载返回稳定 non-retryable not-found。
- COS 408/429/5xx 或无 HTTP 状态的网络失败：retryable storage unavailable。
- COS 其他 4xx：non-retryable storage unavailable，且不暴露 Provider payload。
- ClamAV `FOUND`：malicious；clamd 明确 `ERROR`：unscannable；网络、timeout、非法响应：retryable scan unavailable。
- 文件超过调用方 scan/read ceiling：policy rejected，不调用扫描器或继续读取。

## Acceptance blockers

1. 测试 Bucket Owner 需确认测试 Region/Bucket、私有访问、CORS/SSE、生命周期、最小 CAM 动作与清理授权，并以受控文件分发测试凭据。
2. 在批准环境显式运行 `AI_CRM_COS_CONFORMANCE_ENABLED=true pnpm --filter @ai-crm/worker test`；5 个公共契约用例全部执行而非 skipped 后才可登记真实 Bucket 证据。
3. Worker 组合线需把上述 typed 配置/Secret 挂载接入 Host B，并注入 `TencentCosStorageAdapter` 与 `ClamAvMalwareScanner` 到 PostgreSQL File Center service/file maintenance handler。
4. 运维 Owner 需提供 ClamAV 私网/TLS 边界、签名库更新、固定容量/告警、COS/ClamAV 故障恢复证据；完成前不得宣称本线生产 Ready。

## API production composition

- API production typed config 新增 COS Bucket/Region/timeout、分离的 SecretId/SecretKey 文件，以及必须显式提供的 upload/session/download/scan policy ceilings；仓库不提供猜测的生产值。
- API 使用正式 PostgreSQL File Center store、COS Adapter、Authorization service 和 Audit service 组合 `FileCenterService`；HTTP 外层与服务内层均重新授权。File actor 使用已建立的 workforce person ID，避免把不可逆认证主体摘要误当组织事实。
- API 只暴露现有已审 `create upload / complete upload / authorize download` HTTP 路由；扫描仍仅允许 Worker 调用，API 中的 scanner Port 故意失败关闭。
- `file-center-provider` readiness 已由长期 `false` 改为真实私有 Bucket `HEAD` 能力探针，并仍与数据库兼容性、运行角色和定期探针生命周期共同失败关闭。
- 共享工作区中的并行 API 组合线已同时接入 Task/Notification PostgreSQL 查询与各自 Authorization/Audit ports；该部分不属于本 Provider 切片的实现或验收声明。

## Eight-area review

- Authorization：Adapter 只接收控制面生成的 opaque handle；不拥有业务授权。真实 CAM 最小权限仍待 Owner 审批。
- Idempotency：delete 为 COS 原生收敛；quarantine 使用 handle SHA-256 的确定 key，copy 成功后 delete，可在部分失败后重试。
- Transactions：无跨 PostgreSQL/COS 事务；由文件中心状态和后台任务对账收敛。
- Migrations：无变更。
- Observability/Audit：错误只暴露稳定分类；不记录 URL、Bucket、handle、Secret、内容或 Provider payload。运行指标/告警由生产组合线补齐。
- Backward compatibility：Port 未变；Local Adapter 不变；test harness 仅增加显式 test subpath。
- Secrets：两份 typed file-backed COS Secret；没有真实值或默认值进入仓库。
- Failure modes：404、5xx、bounded read、invalid handle、ClamAV 三类业务结果与 transport failure 有专项测试。
