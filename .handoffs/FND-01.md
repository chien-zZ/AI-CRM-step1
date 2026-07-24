# FND-01 Workspace 与包执行基线

- Status: completed
- Owner: 当前会话
- Allowed paths: 根 Workspace 配置、工程配置包、各应用/包最小清单与公共入口、`scripts/check/`

## 已知事实

- 当前只有根包被 pnpm 识别，Turbo 执行 0 个包级任务。
- 现有应用和包均只有 README，不存在可执行公共入口。
- Node 24.15.0 与 pnpm 9.15.0 已由仓库固定。

## 允许的假设

- 所有包统一使用 ESM、严格 TypeScript 和独立 `dist/` 输出。
- 尚未实现的平台包只公开业务中立的模块标识，后续工作包替换或扩展该公共入口。

## 禁止的假设

- 不创建业务实体、权限、状态、路由或供应商 API。
- 不以关闭严格检查或允许无测试代替工程基线。

## 非目标

- 不实现客户端界面、API/Worker 组合根或平台模块行为。

## 验证

- pnpm 识别根包之外的 28 个 Workspace Project；Turbo 对其执行真实包级任务。
- `pnpm build --force` 与 `pnpm typecheck --force` 均为 28/28 成功。
- `pnpm check` 通过，覆盖所有包的 Build、Lint、Typecheck、Test 和 Contracts Check。
- 深层导入与 Workspace 循环依赖负向测试均确认违规会失败。
- 每个包的共享 Smoke Test 从本包源码公共入口导入并核对包标识；禁止空测试通过。

## 独立审查

- Authorization/Idempotency/Transactions/Migrations: 本包只建立工程执行与依赖边界，不实现对应业务行为。
- Observability: 覆盖率输出和确定性任务结果已建立；运行时观测属于 INF-02。
- Backward compatibility: 公共入口限定为包根导出，边界检查禁止深层导入并检测依赖环。
- Secrets: 工程任务不读取或输出 Secret。
- Failure modes: 非 Node 24、非固定 pnpm、缺脚本、非法依赖、无测试和严格类型错误均失败关闭。

## 未解决问题

- 无。
