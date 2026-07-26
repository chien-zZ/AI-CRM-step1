import type { InternalMobilePort, MobileItem, ReadyMobileBootstrap } from "./workbench-port";

const items = (label: string, prefix: string): readonly MobileItem[] => Array.from({ length: 4 }, (_, index) => ({
  id: `fixture-${prefix}-${String(index + 1).padStart(2, "0")}`,
  title: `合成${label} ${String(index + 1)}`,
  summary: "仅用于验证内部移动壳层、路由恢复和弱网状态。",
  status: index === 0 ? "待处理" : "可查看",
}));

const fixture: ReadyMobileBootstrap = {
  kind: "ready",
  fixture: true,
  contextLabel: "合成内部上下文",
  collections: {
    tasks: items("任务", "task"),
    notifications: items("通知", "notification"),
    forms: items("表单", "form"),
  },
};

export const developmentFixturePort: InternalMobilePort = {
  bootstrap: () => Promise.resolve(fixture),
  logout: () => Promise.resolve({ kind: "signed-out" }),
};
