# 第一阶段生产发布 Runbook

- 状态：OPS-01 基线；首次真实发布仍受 CMP-01、E2E-01、OPS-02、容量评审和人工批准阻塞
- 架构依据：ADR-0021、ADR-0022、ADR-0023
- 适用拓扑：两台 Ubuntu CVM、两个独立 Docker Compose Project

## 1. 发布前失败关闭门

以下任一证据缺失即停止发布，不允许口头豁免：

- 精确提交的 `pnpm check`、契约/生成制品校验、迁移空库升级、适用集成/E2E 与预发布冒烟通过。
- 应用镜像带 SHA-256 摘要；第三方镜像带明确非 `latest` 版本并已完成许可证、安全与兼容评审。
- API 与 Worker 镜像都包含完整受审 `packages/**/migrations` 目录和固定位置的 `ai-crm-migrations.manifest.json`；分别解包校验文件清单，且规范化 manifest 摘要与 release manifest `artifacts.migrationHead` 一致。镜像内自带 manifest 不作为自己的信任根。
- 新旧 HTTP、事件、Job、数据库和配置版本在逐台发布窗口兼容。
- PostgreSQL 恢复点存在且位于两台主机故障域之外；不可逆变更有前滚修复和人工批准。
- Secret 文件清单、Owner、消费者、权限、轮换/撤销顺序和事故动作已核对，但证据不包含值。
- Worker Drain、回滚镜像、触发条件、操作人、批准人、通信渠道和观测 Runbook 已确认。
- Sentry 区域/合同/数据边界、云监控和外部探测已经单独批准并以受控故障验证；不可用时不阻断业务。

把上述结果写入版本 1 release manifest，以 `verify-release.mjs` 验证。Manifest 是证据索引，不替代原测试报告、恢复点或人工批准记录。

## 2. 配置与 Secret 预检

1. 在两台主机分别确认目标项目名只能是 `ai-crm-prod-a` 或 `ai-crm-prod-b`，确认私网地址属于批准网段。
2. 从批准 manifest 生成仅含 release ID/镜像引用的 `images.vars`，与 root-owned 非敏感 host vars 分开保存；不使用隐式 `.env`。
3. 逐项检查 Secret 文件存在、`root:<专用 Secret-reader GID>` ownership、`0440`、消费者最小化和只读单文件挂载。Compose 中只有声明 Secret 的服务获得该 supplementary GID；普通主机账号不得长期加入该组。任何命令和日志均不得输出内容。
4. 分别执行 `docker compose ... config --quiet`。Host B 另输出一份受限的已渲染 Compose 临时文件，执行 `node scripts/check/verify-worker-drain.mjs <rendered-host-b.yml>`；应用 drain 秒数必须是正整数并严格小于解析后的 Compose stop grace，等于、未解析变量或仅有字符串均停止发布。保留安全摘要/结果后删除临时文件。
5. 仅在批准的 BFF 单上一版本密钥轮换窗口，为每台主机显式追加匹配的 `compose.host-*.bff-previous-key.yml`。未轮换时不得声明 previous ID 或挂载 previous key；启用时 ID、typed `*_FILE` 与单一命名文件必须齐全，否则停止。完成兼容窗口后移除 overlay 和主机文件，再执行 `docker compose ... pull`。

Keycloak 首次管理员建立或恢复必须在受控维护窗口使用独立、临时、文件式凭据执行并进入安全审计；完成后立即撤销。常驻 Keycloak Compose 服务不挂载 bootstrap 管理员凭据，也不使用开发 Realm import。

## 3. 串行发布顺序

1. 冻结共享入口、迁移和生成制品窗口；记录当前 release、镜像摘要、迁移 head、配置/契约 hash。
2. 在 Host A 用单一迁移身份执行已评审的兼容扩展迁移；应用运行身份不得获得 DDL 权限。迁移失败立即停止，不更新容器。
3. 对 Worker 发出停止接收信号，等待在途 Job 在批准上限内完成。超时后保留可重放事实，不强行确认成功；未证明幂等和兼容时不得启动新 Worker。
4. 更新 Host B 的 API/Worker/Edge。等待 API liveness/readiness、Worker health、外部最小探测和业务中立冒烟通过。
5. 将 Host B 置入批准入口路径后观察连续窗口；异常率、就绪、消息积压或敏感日志抽样失败时停止并回滚该主机。
6. 更新 Host A 的 API/Edge，每个实例就绪并通过同一冒烟后才结束逐台窗口。状态组件不随普通应用发布重建或删除 Volume。
7. 重新开放 Worker 接收，验证 Outbox/Inbox、重复投递、在途任务和积压恢复；不得用通知或日志代替业务事实。
8. 保存 release manifest、Compose config hash、镜像摘要、迁移结果、健康/冒烟/告警证据和合并提交；不得保存 Secret、Cookie、Token、正文或个人数据。

## 4. 回滚与前滚

- 触发条件包括新实例不就绪、关键业务中立路径失败、错误率持续越界、消息无法安全消费、敏感信息进入观测或无法确认数据兼容。
- 先停止继续放量并 Drain 新 Worker，再把受影响主机切回上一批准的不可变应用镜像。每台回滚后重新执行健康和冒烟。
- 数据库迁移不随镜像自动回滚。兼容扩展保留；不可逆变更使用已批准前滚修复或恢复点，并升级为事故处置。
- Keycloak、Flowable、RabbitMQ、Nginx 或 Secret 变更分别使用自己的版本化回滚/轮换步骤，不能由应用镜像回滚暗中覆盖。

## 5. 主机/入口故障

- Host A 或状态组件故障会中断相应能力；两台服务器没有自动仲裁。先保护数据和限制继续写入，再按 OPS-02 恢复手册处理。
- 只有在 Host B Edge、API、TLS、私网依赖、DNS/入口权限和外部探测均已批准验证后，才可人工切换入口。切换不代表状态服务已恢复。
- 记录实际恢复点和耗时，但在恢复演练和业务影响分析批准前不对外声称 RPO、RTO 或 SLA。

## 6. Worker Drain 合约

CMP-01 必须让 Worker 在 SIGTERM/停止接收后：不领取新任务；给在途任务有界完成时间；未完成任务保持可重试事实；关闭连接前刷新安全日志/Trace；以非零状态暴露无法安全停止。`compose.host-b.yml` 的健康命令和 stop grace 只是部署约束，不能替代应用实现与 E2E 证据。每次发布仍必须对已渲染配置执行数值门禁；仓库静态模板只强制两个输入失败关闭，不能凭未解析变量证明时间关系。
