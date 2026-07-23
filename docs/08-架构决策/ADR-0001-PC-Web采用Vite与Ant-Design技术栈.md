# ADR-0001：PC Web 采用 Vite 与 Ant Design 技术栈

- 状态：已接受
- 日期：2026-07-22
- 决策人：项目负责人
- 适用范围：`apps/workbench-web`

## 背景

PC Web 既要承载第一阶段 CRM，也要逐步扩展为全公司工作台。项目还会建设自己的 `platform-sdk`、应用注册、统一授权和契约体系，并主要由多个 AI 开发任务持续维护。

完整 Ant Design Pro v6 模板使用 Umi Max。它适合快速建设标准后台，但其插件和运行时约定会与本项目的平台层形成部分重叠，也增加 AI 在并行开发、故障定位和框架升级时需要理解的隐式行为。

项目需要保留 Ant Design 的后台 UI 能力，同时让路由、权限接入、请求、状态初始化和测试结构显式存在于仓库中。

## 决策

`apps/workbench-web` 采用以下基线：

- React 19
- Vite
- TypeScript
- Ant Design 6
- `@ant-design/pro-components`
- React Router
- TanStack Query
- OpenAPI 生成客户端
- `platform-sdk`
- Vitest 与 Playwright

具体约束如下：

1. 不采用 Umi Max，不直接使用完整 Ant Design Pro 应用模板。
2. 使用 ProLayout 构建工作台整体布局，使用 ProTable、ProForm 和 ProDescriptions 建立标准列表、表单和详情能力。
3. React Router 负责显式路由。应用注册表可以生成导航和路由配置，但最终路由表、守卫和错误边界必须可在源码中直接定位和测试。
4. TanStack Query 负责服务端数据状态、缓存、失效和请求生命周期。Zustand 不作为默认全局状态层，只在存在明确的跨组件客户端状态需求时引入。
5. 认证上下文、授权、任务、通知、文件等平台能力通过 `platform-sdk` 和正式契约接入，不在页面或路由中复制平台逻辑。
6. 菜单和按钮可以根据权限结果控制展示，但服务端授权始终是最终裁决。
7. HTTP 客户端和数据类型以分模块 OpenAPI 契约的生成结果为准，不在页面内维护重复接口模型。
8. Ant Design Design Token 是视觉变量的权威入口。`antd-style` 与 CSS Modules 的具体职责边界在前端工程规范中另行确认；确认前不引入第二套全局样式体系。
9. Vitest 覆盖组件、路由、权限展示和状态适配器；Playwright 覆盖登录入口、工作台导航及关键跨页面流程。
10. 通用 UI 只有在实际跨应用复用后才进入 `packages/shared-ui`，工作台专用组件保留在 `apps/workbench-web` 内。
11. `D:\CRM-demo-Ant-design\myapp` 中已有的纯前端工作台作为设计与交互参考，不作为代码、依赖、契约或业务规则来源。具体参考边界见[PC 工作台 Demo 参考基线](../04-工程手册/PC工作台Demo参考基线.md)。

## 已考虑的方案

### 完整 Ant Design Pro v6 与 Umi Max

优点是后台布局、路由、国际化和工程能力开箱即用。缺点是插件与运行时约定较多，和自有平台层部分重叠，AI 需要同时理解项目约定与 Umi 约定。项目在实施前撤回了最初采用完整方案的决定，因此不采用。

### Vite、Ant Design 6 与 ProComponents

需要自行建设路由、权限接入、国际化和工作台模板，但这些胶水代码可以显式实现并通过测试固化，更适合长期 AI 托管、多任务并行和平台能力演进。因此采用。

### HeroUI

历史材料曾使用 HeroUI Pro、HeroUI OSS 和 Tailwind CSS。项目负责人已明确撤销该方向，因此不采用。

## 影响

- 工作台需要自行维护一套小而稳定的应用壳和页面模板。
- 路由、平台初始化、请求错误处理和权限展示不会由 Umi 插件隐式提供，必须有明确代码、契约和测试。
- 可以独立升级构建工具、路由和平台 SDK，减少对 Ant Design Pro 官方模板结构的绑定。
- ProComponents 只承担 UI 与交互职责，不成为业务状态或授权事实源。
- 新 PC 页面需延续已验证的工作台信息密度、导航层级、列表/详情模式和反馈习惯，明显偏离应在任务交接中记录原因；这不授权复制 Demo 的 Umi、Mock 或业务模型。
- 依赖的具体补丁版本由锁文件和依赖更新策略管理，本 ADR 只固定主要技术代际。

## 非目标

- 本 ADR 不决定身份提供商、登录方式和令牌模型。
- 本 ADR 不定义任何 CRM 页面、实体、字段、状态、权限码或业务流程。
- 本 ADR 不决定内部移动端或外部端的技术栈。
- 本 ADR 不立即授权安装依赖或生成应用代码；工程初始化作为独立任务执行并验收。

## 决策修订记录

- 2026-07-22：最初确认完整 Ant Design Pro v6 与 Umi Max，随后在任何实现发生前重新评估 AI 托管和平台边界，最终修正为本 ADR 所述的 Vite 显式架构。
- 2026-07-23：确认已有纯前端工作台 Demo 为后续 PC 工作台的设计与交互参考，同时保持 Vite 显式架构和正式业务边界不变。
