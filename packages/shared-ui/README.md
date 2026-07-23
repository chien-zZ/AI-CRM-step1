# Shared UI

Cross-application components are added only after genuine reuse is demonstrated. Application-specific components remain within their owning application.

The first JSON Schema renderer remains inside `apps/workbench-web`. It moves here only after a second application proves reuse, and UI component types never become server-side form contracts. See [ADR-0013](../../docs/08-架构决策/ADR-0013-版本化表单与业务配置中心.md).

PC Ant Design components and Taro/NutUI components use different runtimes and do not share component implementations. Cross-client reuse starts with design tokens and framework-neutral assets; any mobile UI package requires proven reuse between the two Taro applications. See [ADR-0016](../../docs/08-架构决策/ADR-0016-Taro内部移动端与外部多端技术栈.md).
