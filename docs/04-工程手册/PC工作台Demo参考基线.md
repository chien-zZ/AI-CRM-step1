# PC 工作台 Demo 参考基线

- 状态：已确认
- 日期：2026-07-23
- 适用范围：`apps/workbench-web` 的应用壳、平台中立页面、后续经确认的业务页面
- 参考来源：`D:\CRM-demo-Ant-design\myapp` 中 `/dept3/*` 工作台快照
- 架构依据：[ADR-0001](../08-架构决策/ADR-0001-PC-Web采用Vite与Ant-Design技术栈.md)

## 1. 口径

此前完成的纯前端工作台 Demo 作为后续 PC 工作台的**设计与交互参考基线**。开发应用壳、导航、列表、详情、任务、通知、审批、表单和操作反馈时，应先检查本文件提炼的 Demo 模式，保持工作密度、信息层级和操作习惯的连续性。

Demo 不是正式项目的代码基线、运行架构或业务事实源。正式项目仍使用 Vite、React Router、TanStack Query、OpenAPI 生成客户端、`platform-sdk` 和服务端事实源，不恢复 Umi Max、Umi Model、纯前端 Action Engine 或 `localStorage` 业务持久化。

临时 Demo 目录可以删除。本文是删除后仍需保留的自包含参考口径；删除或继续修改 Demo 均不会自动改变已接受 ADR、正式契约和已确认业务规则。

## 2. 已知事实

- 审阅快照是一个可运行的纯前端 Ant Design Pro Demo，而非只有静态页面的原型。
- 审阅范围以 `myapp/src/dept3/`、`myapp/src/pages/dept3/`、`myapp/config/routes.ts` 和 `docs/result/` 中的确认版说明为主。
- 审阅时依赖包含 React 19.2、Ant Design 6.5、ProComponents 3.1 和 Umi Max 4.6；这些版本只标识参考快照，不覆盖正式项目的依赖决策和锁文件。
- `/dept3/*` 使用自建 `Dept3Layout`，实际布局不是标准 ProLayout 默认外观。
- Demo 包含四岗位切换、双列导航、全局搜索、通知、模拟时钟、主题切换、AI 助手以及大量具体业务页面。
- Demo 通过统一前端 Store、Action Engine、Mock Seed 和 `localStorage` 让多个岗位共享演示状态。
- Demo 仓库中的工作台实现位于未纳入其基准提交的本地工作树，因此不能把 Git Commit 当作完整 Demo 版本标识。

## 3. 允许的参考与假设

- 可以参考应用壳的信息层级、工作区密度、导航分组、页面模板和操作反馈。
- 可以用合成平台数据重现任务、通知、表单、文件和 Assignment Context 的交互形态。
- 可以把 Demo 中成熟的纯 UI 模式重写为正式项目组件，但必须重新命名、重新接入正式契约并补测试。
- 可以根据正式应用注册和权限结果调整导航结构；双列导航是重要参考模式，不是绕过 ProLayout 和应用注册的理由。
- 可以在任务交接中提出从 Demo 延续的设计 Token、尺寸或组件候选，评审后再固化。

## 4. 禁止的假设

- 不得从 Demo 推断正式的客户、学员、客资、工单、订单、岗位、角色、字段、状态、SLA、审批路线、指标或数据范围。
- 不得复制 Demo 的角色编码、前端权限常量、`/dept3/*` 路由或导航配置作为正式契约。
- 不得把 Demo 的 `dept3Store`、Action Engine、Selector 或时间线副作用当作正式领域状态机。
- 不得用 Mock、`localStorage` 或 TanStack Query Cache 代替服务端事实源。
- 不得让前端路由或按钮可见性代替服务端授权。
- 不得因为 Demo 已有 AI 助手、邮件、绩效、经营看板或多主题，就把它们加入第一阶段范围。
- 不得直接复制临时目录、Umi 配置或依赖到正式仓库。

## 5. 非目标

- 本文不确认任何 CRM 业务页面或业务规则。
- 本文不改变 ADR-0001 的技术栈，不决定具体补丁版本。
- 本文不要求第一阶段复刻 Demo 全部页面、全部主题或全部交互。
- 本文不把 Demo 提升到根 `AGENTS.md` 所定义的业务权威链中。

## 6. 应延续的设计与交互模式

### 6.1 应用壳与导航

Demo 的主壳由两列可折叠导航、48px 顶栏和主内容区组成：一级导航参考宽度为 120px/折叠 56px，二级导航参考宽度为 180px/折叠 48px。顶栏集中承载面包屑、当前岗位、搜索、通知和个人入口。

正式实现应延续以下原则：

- 一级导航表达应用或能力分组，二级导航表达分组内页面，当前层级始终清晰。
- 工作台专属能力与任务、通知、设置等公共能力在信息架构上分组，不混为一个长菜单。
- 折叠、选中和深链进入时的高亮行为稳定，图标按钮提供 Tooltip 和可访问名称。
- 顶栏保持紧凑，优先放高频全局入口；演示时钟、数据重置和主题实验只允许出现在明确的开发工具区。
- Demo 的“岗位切换”在正式项目中映射为 Active Assignment Context 切换，不是角色模拟器，也不对多个任职做权限并集。

第一阶段仍以 ProLayout 作为正式壳层组件。若要采用 Demo 的双列 Sider 外观，应在 ProLayout 的应用注册、路由、权限和响应式能力之上实现并单独测试，而不是复制 `Dept3Layout`。

### 6.2 首页与工作密度

Demo 首页采用一行紧凑指标、主待办区和最近动态区，第一屏直接呈现需要处理的工作。正式页面应保持以下方向：

- 页面标题使用工作台尺度，不使用营销页 Hero 或大段功能说明。
- 指标只展示可追溯的事实或投影，并提供清晰下钻；不能由前端另维护一份展示数字。
- 主区域优先待办、异常和近期活动，减少装饰性卡片。
- 卡片用于独立对象或指标，不把每个页面区块都包成悬浮卡片，也不嵌套卡片。
- 1366、1440 和 1920 宽度下均应保持可扫描性，动态内容不得推动固定导航和工具栏跳动。

### 6.3 列表、主从视图与详情

Demo 的 `RecordInbox` 使用约 300px 左侧检索列表和右侧详情，适合通知、审批、工单等连续处理场景；标准对象集合则应使用 ProTable。

正式实现遵循：

- 需要比较、批量操作、排序或复杂筛选时使用 ProTable。
- 需要连续阅读和逐项处理时，可以使用“左列表 + 右详情”的收件箱模式。
- 筛选、分页、Tab、选中对象和抽屉状态写入 URL；刷新、分享允许的深链或浏览器返回后可恢复。
- 详情标题区优先展示稳定 ID、当前状态、责任上下文、关键时间和版本；轻量编辑使用 Drawer/Modal，长流程使用步骤表单或独立页面。
- 多列表格固定关键列并支持横向滚动，长文本进入详情，不允许压缩到重叠。

### 6.4 状态、反馈与风险操作

- Loading、Empty、Error、403、404、500、离线、Session 过期、维护、Warning 和 Blocking 状态必须有明确呈现。
- 状态色必须同时配文字或图标；红色只表示阻断、失败或高风险。
- 所有命令使用具体动词和对象，例如“标记通知已读”，不使用脱离上下文的“提交”。
- 按钮必须覆盖执行中、成功、失败、禁用和无权限状态；禁用时解释原因。
- 高风险操作的确认文案说明对象、后果和不可逆部分，不使用笼统“确定吗”。
- 操作成功后保留合理工作位置并更新相关 Query，不无故跳回首页。

### 6.5 页面组合与视觉节奏

- 优先使用 Ant Design 6 和 ProComponents 的 Token、布局、表格、表单、描述和反馈能力。
- 工作台整体保持安静、紧凑、面向重复操作；标准内容区参考 16px 或 24px 间距，并通过统一 Token 固化。
- 标题、辅助信息和标签采用清晰层级，紧凑面板内不使用过大的显示字体。
- 头像、标签、图标和状态只承担识别功能，不作为无业务含义的装饰。
- Demo 的 13 套主题和渐变背景属于实验能力。第一阶段只需建立可维护的正式主题 Token，不复刻主题市场。

## 7. Demo 机制到正式架构的映射

| Demo 机制 | 正式项目实现 | 迁移约束 |
|---|---|---|
| Umi 路由与 `history` | React Router 显式路由与导航 API | 路由 ID、守卫和错误边界可定位、可测试 |
| Umi Initial State/Model | BFF `/me`、`platform-sdk`、TanStack Query | 不保存 Keycloak Token，不复制全局业务 Store |
| 岗位切换器 | Active Assignment Context | 切换后服务端重新解析权限和数据范围 |
| 前端角色路由判断 | Application Registry + Authorization View | 前端只控制呈现，API 仍逐次授权 |
| `dept3Store` | 平台模块/未来领域模块的服务端事实 + Query Cache | Cache 不是事实源，禁止跨模块表查询 |
| Action Engine | 正式 HTTP Command + 服务端事务/授权/审计 | 先改契约，再实现；失败语义显式 |
| `localStorage` 业务持久化 | PostgreSQL 模块自有 Schema/Repository | 浏览器只保存允许的非敏感 UI 偏好 |
| Mock Seed/Adapter | OpenAPI 生成 Client + MSW/测试 Fixture | Fixture 只放测试，不提升为业务模型 |
| 时间线 | Audit/领域事件/活动投影的受控视图 | 审计、业务事实和通知不可互相替代 |
| 工单/待办视图 | Workflow + Task Center | Workflow 状态与任务投影分离 |
| 通知列表 | Notification Center + TanStack Query 轮询 | 通知已读不代表任务完成 |
| 文件元信息 | File Center `FileReference` | 不暴露 Bucket、Object Key 或永久 URL |
| 全局搜索 | 经批准的跨模块 Search Contract | 第一阶段不聚合未确认业务对象 |
| AI 助手侧栏 | 未来批准的 AI Use Case + AI Gateway | 第一阶段不实现真实助手、Prompt 或自动动作 |

## 8. 第一阶段应用方式

第一阶段不创建 Demo 中的 CRM 领域页面，只在业务中立 Walking Skeleton 中验证可复用模式：

- 应用壳：应用注册导航、Assignment Context、通知入口和个人入口。
- 任务与通知：标准列表或收件箱式主从视图、未读/待办状态、授权深链。
- 表单与文件：版本化测试表单、上传/扫描状态、明确的错误和阻断反馈。
- 异常状态：403、404、500、离线、Session 过期和维护页面。
- URL 状态：平台中立筛选、分页、Tab、选中对象或抽屉状态可恢复。

AI Agent 不得为满足视觉参考而创建 Lead、Customer、Student、Order、Dashboard 等占位模块。页面需要数据时使用仅存在于测试或 Fixture 的平台中立对象。

## 9. 实施与验收要求

每个 PC Web 任务的 `.handoffs/<task-id>.md` 除仓库通用四项外，还需记录：

- **已知事实**：本次页面对应的正式契约、权限、路由和平台能力。
- **允许假设**：采用了本文件中的哪些布局或交互模式。
- **禁止假设**：明确未从 Demo 继承的业务字段、状态、角色和流程。
- **非目标**：本次不实现的 Demo 功能。
- **参考差异**：与本基线存在的明显差异、原因和评审结论；没有差异也要写“无”。

验收至少检查：

- 技术实现符合 ADR-0001，依赖中没有 Umi Max 或 HeroUI。
- 页面复用了正式 Token 和工作台模板，没有复制 Demo 私有代码或 DTO。
- 导航、信息密度、列表/详情层级和操作反馈与本基线一致，或差异已有记录。
- URL 状态恢复、键盘焦点、Tooltip、`aria-label`、文本溢出和桌面宽度经过测试。
- 前端展示权限与服务端授权分别验证，深链和直接 API 不能绕过授权。
- Demo 业务术语、角色、字段、SLA、审批路线和 Mock 数据没有进入生产代码或契约。

## 10. 参考文件清单

本次口径由以下 Demo 文件提炼。临时目录删除后不要求这些路径继续存在：

- `docs/result/00-三部纯前端总体架构-确认版.md`
- `docs/result/20-Claude-Code实施与验收规范-确认版.md`
- `myapp/package.json`
- `myapp/config/routes.ts`
- `myapp/src/dept3/layouts/Dept3Layout.tsx`
- `myapp/src/dept3/layouts/navConfig.tsx`
- `myapp/src/dept3/components/business/RecordInbox.tsx`
- `myapp/src/dept3/components/business/DetailKit.tsx`
- `myapp/src/dept3/components/business/TodoList.tsx`
- `myapp/src/dept3/components/business/WorkflowTimeline.tsx`
- `myapp/src/models/dept3Store.ts`
- `myapp/src/models/dept3Session.ts`
- `myapp/src/dept3/services/actions/engine.ts`
- `myapp/src/pages/dept3/` 下的首页、审批、通知、列表和详情代表页面

