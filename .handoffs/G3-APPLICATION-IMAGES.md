# G3-APPLICATION-IMAGES API/Worker 生产镜像

## Objective

为 API 与 Worker 建立可重复的非 root 生产镜像和构建流水线，并在发布前从两份实际镜像文件系统重新验证完整迁移制品。

## Known Facts

- Node.js 运行时基线为 24.15.0，pnpm 为 9.15.0。
- 生产 Compose 只接受调用方提供的 digest-pinned API/Worker 镜像引用。
- 应用启动只读检查迁移兼容性，不自动执行迁移。
- 仓库已有确定性迁移 manifest 和 API/Worker 联合解包验证器，但此前没有 Dockerfile 或镜像流水线。

## Allowed Assumptions

- GitHub Actions 的受保护 `main` 环境可以使用仓库 `GITHUB_TOKEN` 写入同仓库 GHCR；实际分支保护、审批和发布授权仍由仓库治理证据确认。
- Node `24.15.0-bookworm-slim` 是本阶段评审的精确补丁版本；生产发布仍以流水线输出的应用镜像 digest 为唯一 Compose 输入。

## Forbidden Assumptions

- 不把成功构建当作部署批准、真实 Secret/TLS、恢复演练或运行 Ready 的证据。
- 不写入 Registry credential、生产 Secret、主机、域名或批准摘要。
- 不把镜像内自带的 manifest 当作信任根；批准摘要从同一受审源码独立生成并传给联合验证器。

## Non-goals

- 不执行生产部署、数据库迁移、镜像签名或云端恢复演练。
- 不改变应用、模块、HTTP/事件合同或生产 Compose 的授权边界。

## Result

- `apps/api/Dockerfile` 与 `apps/worker/Dockerfile` 使用相同精确 Node/pnpm 基线，构建工作区后只部署对应应用的生产依赖；运行阶段使用 `node` 用户。
- 两份镜像都携带固定路径 `/app/ai-crm-migrations.manifest.json` 及完整 `packages/**/migrations`。
- `.github/workflows/application-images.yml` 在 PR 构建并解包验证两份镜像；非 PR 运行只在联合验证成功后发布 commit-SHA tag，并记录 Registry 返回的不可变 digest。
- `scripts/check/application-images.test.mjs` 防止运行用户、精确版本、迁移生成或“验证后发布”顺序回退。

## Remaining External Evidence

当前本地 Docker daemon 无法连接 Docker Hub，因而本工作区不能下载精确基础镜像并冒充已完成的镜像构建证据。首个受保护 CI 运行必须保留：基础镜像解析、两份构建日志、联合解包验证、GHCR digest，以及把 digest 写入 release manifest 后的独立审批记录。
