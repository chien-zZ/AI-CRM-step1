import type { ExternalPortalPort } from "./portal-port";

export const developmentFixturePort: ExternalPortalPort = {
  bootstrap: () => Promise.resolve({
    kind: "ready",
    fixture: true,
    entries: [
      { id: "synthetic-boundary", title: "合成边界示例", summary: "仅验证外部端布局、恢复和失败状态，不代表真实业务入口。" },
      { id: "synthetic-targets", title: "合成双端示例", summary: "同一页面语义分别构建为 H5 与微信小程序制品。" },
    ],
  }),
};

export const externalPortalPort = developmentFixturePort;
