import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { developmentFixturePort } from "./development-fixture";
import type { WorkbenchPort } from "./workbench-port";

vi.mock("@ant-design/pro-components", () => ({
  PageContainer: ({ title, children }: { title?: ReactNode; children?: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
  ProLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

function renderApp(entry: string, port: WorkbenchPort = developmentFixturePort): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}><App port={port} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("workbench shell", () => {
  it("restores collection filter, tab, selection and page from the URL", async () => {
    renderApp("/tasks?tab=history&filter=处理中&page=1&selected=fixture-task-02");

    expect(await screen.findByRole("heading", { name: "任务" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "历史" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "状态筛选" })).toBeInTheDocument();
    expect(screen.getAllByText("处理中").length).toBeGreaterThan(0);
    expect(screen.getByText("fixture-task-02")).toBeInTheDocument();
  });

  it("shows every required runtime state with explicit copy", async () => {
    const cases = [
      ["/status/403", "无权访问"],
      ["/missing", "页面不存在"],
      ["/status/500", "暂时无法加载"],
      ["/status/offline", "网络已断开"],
      ["/status/session-expired", "会话已过期"],
      ["/status/maintenance", "服务维护中"],
    ] as const;

    for (const [entry, title] of cases) {
      const { unmount } = render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={[entry]}><App port={developmentFixturePort} /></MemoryRouter>
        </QueryClientProvider>,
      );
      expect(await screen.findByText(title)).toBeInTheDocument();
      unmount();
    }
  });

  it("fails closed when the runtime adapter reports maintenance", async () => {
    renderApp("/workspace", { bootstrap: vi.fn().mockResolvedValue({ kind: "maintenance" }), logout: vi.fn() });
    expect(await screen.findByText("服务维护中")).toBeInTheDocument();
  });

  it("uses the BFF login entry for signed-out sessions", async () => {
    renderApp("/workspace", { bootstrap: vi.fn().mockResolvedValue({ kind: "signed-out", loginUrl: "/bff/login" }), logout: vi.fn() });
    const login = await screen.findByRole("link", { name: /登录/u });
    await waitFor(() => expect(login).toHaveAttribute("href", "/bff/login"));
  });
});
