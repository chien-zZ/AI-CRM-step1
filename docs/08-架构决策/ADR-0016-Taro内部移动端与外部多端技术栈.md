# ADR-0016：Taro 内部移动端与外部多端技术栈

- 状态：已接受
- 日期：2026-07-22
- 决策人：项目负责人
- 适用范围：`apps/internal-mobile`、`apps/external-portal` 及跨端工程边界
- 依赖决策：ADR-0001、ADR-0002、ADR-0003、ADR-0005、ADR-0006、ADR-0015

## 已知事实

- 第一阶段必须创建 PC Web、内部移动端和外部端三个独立应用。
- PC Web 技术栈已经固定为 React 19 + Vite + Ant Design 6 + ProComponents。
- 项目负责人确认内部移动端使用 Taro H5，外部端使用 Taro 同时输出 H5 和微信小程序，两端使用 NutUI React，第一阶段不开发原生 App。
- 内部 H5、外部 H5 和微信小程序的认证传输与服务端会话边界已由 ADR-0017 确认，内部人员关联由 ADR-0018 确认，外部访问分级由 ADR-0019 确认；内部 Keycloak 账号恢复、具体外部主体及业务场景尚未确认。

## 允许的假设

- 内部移动端 H5 需要同时能在企微工作台 WebView 和普通手机浏览器运行。
- 外部端 H5 与微信小程序共享同一应用内的领域无关代码和页面语义，但允许通过受控适配器处理平台差异。
- 两个 Taro 应用可以复用工程模板、设计 Token、正式契约和生成客户端，不复用身份边界或发布制品。

## 禁止的假设

- 不从历史材料推断任何移动/外部 CRM 页面、用户类型、登录字段、微信能力或企微免密已经确认。
- 不强制 Taro 应用使用 PC Web 的 React 19；React 版本必须服从所选 Taro 与 NutUI 的官方兼容矩阵。
- 不在 Taro 应用中引入 Ant Design、ProComponents、Umi Max、HeroUI、Expo、React Native 或 JPush。
- 不把 H5 可运行在企微 WebView 等同于企微联合登录已经实现。
- 不把外部 H5/微信小程序共用代码等同于可以共用内部 API、Keycloak Client、会话或权限。

## 决策

### 1. 使用开源 Taro、React、TypeScript 与 NutUI React

`apps/internal-mobile` 和 `apps/external-portal` 使用以下技术族：

- Taro：跨端编译、页面生命周期、路由、环境能力和构建入口。
- React 与 TypeScript：组件和应用代码。
- NutUI React Taro 版：移动组件与基础交互。
- OpenAPI 生成客户端与 `platform-sdk` 的端适用子集：服务端契约接入。

Taro、React、TypeScript 和 NutUI 均使用开源项目，项目不 Fork 或自研跨端运行时。项目自研的是应用壳层、页面、设计适配、端能力适配和业务交互。

选择 Taro 的原因是外部端明确需要 H5 与微信小程序双目标，Taro 能在 React/TypeScript 技术族内提供成熟编译与端 API。内部端也采用 Taro H5，可以减少全 AI 开发需要维护的移动工程模板和调试知识，但两个应用仍独立。

### 2. 目标平台固定

- `apps/internal-mobile` 第一阶段只输出 H5，部署后可从企微工作台 WebView 或普通手机浏览器访问。
- `apps/external-portal` 第一阶段必须输出 H5 和微信小程序 `weapp` 两个制品。
- 两个应用、三个制品均进入 CI 构建和对应目标的冒烟测试，不能只验证 Taro H5 后假定微信小程序可用。
- 第一阶段不输出 React Native、iOS、Android、HarmonyOS 原生包或其他小程序平台。

“内部 H5 可嵌入企微”和“外部端可构建微信小程序”只固定载体。企微应用配置、微信小程序账号、域名白名单、隐私声明、审核材料和登录流程需要独立交付清单。

### 3. 版本由兼容矩阵锁定，不盲目追随 PC Web

工程初始化时选择同时满足 Node 24、Taro、NutUI React、React、TypeScript、微信开发者工具和构建插件的稳定版本组合，并在锁文件和工程基线中固定。

升级任何一项前必须执行 H5 与 `weapp` 全量构建、组件测试和关键设备冒烟。禁止在 CI 使用未锁定的 `latest`，也不为了与 PC Web 统一版本而强行安装 Taro 尚未支持的 React 19。

### 4. 两个应用独立，模板一致

- 每个应用拥有自己的 `package.json`、Taro 配置、页面清单、环境配置、Keycloak Client/会话适配、测试和发布制品。
- 可以复用仓库级 Taro 工程模板、ESLint/TypeScript/Test 配置和设计 Token。
- 不建立包含两个应用页面、路由和业务状态的移动 `shared-core`。
- 内部页面、外部页面、端专用导航和认证逻辑不能因为框架相同而互相导入。
- 共享组件只有在两个应用中证明语义、权限和交互一致后才进入明确的移动 UI 包；PC Ant Design 组件不进入该包。

### 5. 端差异通过窄适配器隔离

Taro H5 与微信小程序在网络、认证回调、文件选择/上传、分享、剪贴板、导航、存储、安全区域和生命周期上存在差异。项目为实际需要的能力定义窄接口，例如 Transport、Session、Navigation、FilePicker 和 PlatformInfo，而不是在页面中散落 `TARO_ENV` 分支。

适配器必须有 H5 与 `weapp` 契约测试。不存在等价能力时，产品明确降级或禁用并给出稳定状态，不能静默跳过安全步骤。

### 6. API 客户端按受众和传输层生成

- OpenAPI 源仍按所有模块维护，生成阶段额外产出经评审的内部与外部受众 Bundle。
- `workbench-web` 与 `internal-mobile` 只能导入获准的内部客户端；`external-portal` 只能导入外部 Allowlist 客户端。
- 客户端模型和端点代码不绑定浏览器 `fetch`。PC Web 注入 Fetch Transport，Taro 应用注入基于 `Taro.request` 的 Transport。
- H5 和 `weapp` 使用同一外部端点契约，端能力差异留在传输/会话适配器，不复制 DTO。
- 受众 Bundle 只是减少暴露和误用，服务端仍必须执行身份、客户端、权限、数据范围和对象级授权。

CI 检查外部应用依赖图和构建制品，防止导入内部客户端、内部路由、内部权限声明或仅供管理员使用的类型。

### 7. 状态、路由和 UI 约束

- Taro 页面配置和路由必须显式存在于各应用源码；服务端配置不能让微信小程序动态加载未编译页面。
- 服务端数据状态优先使用与所选 Taro/React 组合兼容的 TanStack Query，并接入 Taro 前后台、网络变化和取消语义；本地 UI 状态只有在有明确需求时才引入轻量状态库。
- NutUI React 是移动组件权威，设计 Token 和主题适配位于应用或明确的移动设计包中；不混入 Ant Design CSS 与组件。
- 页面按触控、软键盘、安全区域、弱网、加载和重试设计，不将 PC 表格页面等比例缩小。
- 端内表单校验、按钮禁用和路由守卫只改善体验，服务端仍是最终授权与校验边界。

### 8. 认证和会话执行独立安全边界

- `internal-mobile` H5 和 `external-portal` H5/微信小程序分别使用独立 Keycloak Client 和会话边界。
- Taro 应用不得接收或存储 Keycloak Access Token、Refresh Token 或 Client Secret。
- 企微 OAuth、微信 OAuth 和小程序 `code2session` 只能通过服务端认证适配边界并最终归一到 Keycloak 主体。
- H5 采用 BFF HttpOnly Cookie；微信小程序只持有项目签发、短期、可撤销的不透明服务端会话句柄，具体见 ADR-0017。
- 首次关联和账号恢复未确认前，应用只能实现明确的未登录/待关联状态，不能使用 Mock 身份进入正式构建。

### 9. 安全和发布

- 前端制品不包含服务端秘密、COS 永久凭据、企微/微信 Secret 或非公开 Source Map。
- 内部 H5 与外部 H5 使用独立域名/路径策略、CSP、CORS、缓存和发布回滚；外部端不复用内部静态制品。
- 微信小程序只请求批准域名，遵守包体积、隐私清单、权限用途和审核要求；未使用能力不申请权限。
- H5 与 `weapp` 的环境配置采用公开非秘密构建变量，环境不通过运行时猜测域名决定。
- 每个制品可独立回滚，版本信息和 Trace 上下文能关联到服务端请求。

## 工程与测试基线

- 纯函数、适配器和状态逻辑使用与 Taro 版本兼容的单元测试工具。
- 组件测试覆盖 NutUI 交互、加载、空态、错误、重复提交和授权展示。
- 内部 H5 与外部 H5 使用 Playwright 覆盖关键路由和响应式视口。
- 微信小程序使用微信开发者工具及其自动化能力运行页面启动、登录边界、网络失败和关键 walking skeleton 冒烟。
- CI 分别运行内部 H5 构建、外部 H5 构建和外部 `weapp` 构建，并检查包体积、Source Map 和内部依赖泄漏。
- 真机/真实 WebView 验证不能由桌面浏览器模拟完全替代，企微 WebView 与至少一组主流 iOS/Android 微信环境需要发布前冒烟。

## 已考虑的方案

### 内部端使用 Vite H5，外部端使用 Taro

内部 H5 会更轻，但需要维护两套移动组件、路由和端适配工程。既然外部端已必须使用跨端框架，统一 Taro 移动技术族能降低 AI 模板漂移，因此不采用。

### 内外部合并为一个 Taro 应用

可最大化页面复用，但会混合身份、API、导航、发布和安全边界，外部制品容易携带内部能力，因此不采用。

### Expo/React Native 或原生 App

可获得更强原生能力，但增加签名、商店/企业分发、热更新、原生 SDK 和推送运维。第一阶段目标已明确为 H5/微信小程序，因此不采用。

### UniApp 或 Vue 技术族

也能实现 H5/小程序，但会在 React/TypeScript 主仓库内引入第二套组件与状态范式。Taro 更符合当前团队和 AI 上下文，因此不采用。

### 两个独立 Taro 应用，共用工程模板

兼顾跨端效率、React 技术一致性和内部/外部安全隔离，因此采用。

## 影响

- 仓库需要维护 Taro 工程模板、三种移动构建目标和真实 WebView/小程序测试。
- Taro 抽象不能消除平台差异，认证、文件、路由和生命周期仍需明确适配。
- 移动端 React 版本可能不同于 PC Web，需要避免跨应用共享依赖 React 运行时的组件。
- 外部 API 必须形成独立受众 Bundle 和客户端，增加契约生成及兼容性门禁。

## 待后续决策

- 锁定的 Taro、React、NutUI React、TypeScript 和构建插件版本。
- 内部企微 H5、外部 H5/微信小程序的认证传输和服务端会话已由 ADR-0017 确认，内部人员关联由 ADR-0018 确认，外部访问分级由 ADR-0019 确认；内部 Keycloak 账号恢复、具体外部主体及业务场景仍待确认。
- 移动设计 Token、路由约定、请求错误、弱网、文件上传和表单渲染规范。
- 微信小程序账号、域名、隐私、审核、CI 上传和版本发布流程。

## 非目标

- 本 ADR 不定义任何移动/外部 CRM 页面、字段、用户类型、权限或业务流程。
- 本 ADR 不确认企微或微信登录已经实施。
- 本 ADR 不创建原生 iOS/Android App、推送 SDK 或离线数据库。
- 本 ADR 不保证所有 H5 页面无需适配即可在微信小程序运行。
