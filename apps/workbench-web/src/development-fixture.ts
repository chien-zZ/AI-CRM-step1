import type { BootstrapResult, PlatformCollection, WorkbenchPort } from "./workbench-port";

function collection(title: string, prefix: string, statuses: string[]): PlatformCollection {
  return {
    title,
    fixture: true,
    statuses,
    items: Array.from({ length: 7 }, (_, index) => ({
      id: `fixture-${prefix}-${String(index + 1).padStart(2, "0")}`,
      title: `合成${title} ${String(index + 1)}`,
      status: statuses[index % statuses.length] ?? "可用",
      summary: "仅用于验证平台壳层、URL 状态与主从视图。",
      tab: index < 5 ? "active" : "history",
    })),
  };
}

const fixture: BootstrapResult & { kind: "ready" } = {
  kind: "ready",
  fixture: true,
  context: { displayName: "合成使用者", assignmentReference: "fixture-assignment-01" },
  counts: { tasks: 7, notifications: 7, forms: 7, files: 7 },
  collections: {
    tasks: collection("任务", "task", ["待处理", "处理中", "已关闭"]),
    notifications: collection("通知", "notification", ["未读", "已读"]),
    forms: collection("表单", "form", ["可填写", "已停用"]),
    files: collection("文件引用", "file", ["可用", "处理中"]),
  },
};

export const developmentFixturePort: WorkbenchPort = {
  bootstrap: () => Promise.resolve(fixture),
  logout: () => Promise.resolve({ kind: "signed-out" }),
};
