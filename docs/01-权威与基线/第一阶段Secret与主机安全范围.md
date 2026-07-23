# 第一阶段 Secret 与主机安全范围

- 状态：已批准
- 日期：2026-07-23
- 适用阶段：两台服务器 Docker Compose 部署与业务无关 walking skeleton
- 架构依据：ADR-0013、ADR-0021、ADR-0022、ADR-0023

## 采用方案

- 不部署 Vault，不使用腾讯云 Secrets Manager。
- 生产 Secret 保存在两台服务器各自的 root 受限文件中。
- Docker Compose 通过 `secrets` 或只读单文件挂载提供 `/run/secrets/<name>`。
- 项目应用通过 `packages/config` 的 `*_FILE` 引用、启动校验和安全错误读取。
- 异地应急 Secret 包使用开源 `age` 离线公钥加密后保存到受限 COS；解密私钥不在生产主机或 COS。
- 主机使用 SSH 密钥、最小 sudo、私网状态服务、非特权容器和登录/文件变更审计。

## 自研、开源与托管边界

- 自研：Secret 引用、配置加载、格式校验、清单元数据和轮换 Runbook。
- 开源/系统能力：Docker Compose Secret、Linux 权限、OpenSSH、OpenSSL/官方密钥工具和 `age`。
- 腾讯云托管基础设施：CVM、磁盘/COS 静态加密、安全组和审计能力。
- 不使用：Vault、云 Secret 保险库、生产 `.env` 作为标准 Secret 存储。

## 第一阶段必须完成

- 非敏感 Secret 清单：名称、用途、环境、Owner、消费者、引用、轮换和应急动作。
- 两台主机的目录、所有者、权限、分发、原子替换和清理规范。
- 每个容器最小 Secret 挂载和第三方镜像 `*_FILE` 兼容验证。
- Secret 缺失/错误时失败关闭，不使用默认密码或开发值。
- 数据库、消息、身份、会话、COS、Sentry、TLS 和备份 Secret 分离。
- 轮换、撤销、离职回收、疑似泄露和灾难恢复演练。
- 仓库与 Compose Secret 扫描、日志/Sentry 清洗和运维操作审计。

## 第一阶段禁止

- Git、业务配置中心、数据库、普通 `.env`、聊天、工单附件或 Wiki 保存生产 Secret。
- Compose、Dockerfile、镜像层、命令参数、日志、Sentry、Trace 和前端制品出现明文 Secret。
- 全局共享账号、默认密码、公开数据库/队列/管理端口和共享 SSH 账号。
- 将生产数据库或明文 Secret 复制到开发、CI 或日常测试环境。
- 在没有数据分类和正式业务字段时创建字段级加密规则。

## 明确接受的限制

- 无逐次 Secret 读取审计、动态租约和集中即时撤销。
- 主机 root 失陷可暴露该主机所挂载的 Secret。
- 双机分发和轮换需要人工操作，规模增长后必须重新评审集中 Secret 产品。

## 待确认

- Owner、轮换周期、SSH 入口、根路径和容器用户。
- `age` 私钥保管、应急包和双人复核流程。
- TLS 证书与数据分类、字段加密、导出和留存规则。

## 非目标

- 本基线不保存或生成真实生产凭据。
- 本基线不授予任何生产访问权限。
