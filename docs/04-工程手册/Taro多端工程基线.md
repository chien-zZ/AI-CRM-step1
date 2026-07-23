# Taro 多端工程基线

- 状态：技术方向已确认，具体依赖版本和命令待工程初始化
- 适用范围：`apps/internal-mobile`、`apps/external-portal`
- 架构依据：ADR-0015、ADR-0016、ADR-0017、ADR-0018、ADR-0019

## 目标矩阵

| 应用 | 构建目标 | 组件体系 | 发布边界 |
|---|---|---|---|
| `internal-mobile` | Taro H5 | NutUI React | 独立内部 H5 制品 |
| `external-portal` | Taro H5 | NutUI React | 独立外部 H5 制品 |
| `external-portal` | Taro `weapp` | NutUI React | 独立微信小程序制品 |

PC Web 继续使用 Vite + Ant Design，不属于本基线。

## 开源与自研边界

- Taro、React、TypeScript、NutUI React、TanStack Query 和测试工具使用兼容的开源版本。
- 项目自研应用壳层、页面、设计 Token、Transport/Session/Navigation 等窄适配器和业务交互。
- 不自研跨端编译器、组件运行时、路由器或微信小程序基础设施。

## 工程纪律

- 两个应用各自拥有依赖、Taro 配置、页面清单、环境配置、测试与发布，不互相导入 `src/`。
- 页面不得散落平台判断；平台差异进入有测试的适配器。
- External Portal 只能导入外部受众 API 客户端，构建检查内部接口泄漏。
- NutUI React 是移动组件权威，禁止引入 Ant Design/ProComponents CSS 或组件。
- React 版本服从 Taro/NutUI 兼容矩阵，不与 PC Web 做强制统一。
- H5 Session Adapter 只依赖 BFF HttpOnly Cookie 和 CSRF 契约，不读取 Keycloak Token。
- 微信小程序 Session Adapter 只携带短期、可撤销的不透明会话句柄，不接收 Keycloak Token 或微信 `session_key`。
- 内部企微身份无法解析为唯一有效人员时呈现无权访问/待处理状态。外部端只能呈现契约明确允许的匿名、邀请或登录状态；没有已确认场景时不伪造邀请或账号。任何端都不把 Mock 用户打入正式制品。

## 每次变更必须验证

- 两个应用 lint、类型检查和单元/组件测试。
- `internal-mobile` H5 构建。
- `external-portal` H5 与 `weapp` 构建。
- H5 Playwright 响应式冒烟。
- 微信开发者工具自动化冒烟及包体积检查。
- 外部制品不包含内部 API、内部路由、秘密或公开 Source Map。
- 认证测试覆盖客户端会话串用、CSRF、过期/撤销、重复登录与小程序凭据重放。

认证与会话边界见 [ADR-0017](../08-架构决策/ADR-0017-多客户端认证与服务端会话.md)。

具体安装和构建命令在应用工程初始化后补充，当前不虚构不存在的脚本。
