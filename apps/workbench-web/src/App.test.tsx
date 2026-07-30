import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, normalizeReturnTo, pcLoginUrl, RouteErrorBoundary } from "./App";
import { developmentFixturePort } from "./development-fixture";
import type { BootstrapResult, WorkbenchPort } from "./workbench-port";

vi.mock("@ant-design/pro-components", () => ({
  PageContainer: ({ title, children }: { title?: ReactNode; children?: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
  ProLayout: ({
    avatarProps,
    children,
    location,
    menuProps,
    openKeys,
  }: {
    avatarProps?: { render?: (props: object, dom: ReactNode, layout: object) => ReactNode };
    children?: ReactNode;
    location?: { pathname?: string };
    menuProps?: { selectedKeys?: string[] };
    openKeys?: string[];
  }) => (
    <div
      data-testid="pro-layout"
      data-selected={menuProps?.selectedKeys?.join(",")}
      data-open={openKeys?.join(",")}
      data-location={location?.pathname}
    >
      {avatarProps?.render?.({}, <span>session avatar</span>, {})}
      {children}
    </div>
  ),
}));

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderApp(entry: string, port: WorkbenchPort = developmentFixturePort): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}><LocationProbe /><App port={port} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const longText = "synthetic-platform-reference-with-a-deliberately-long-unbroken-value-0123456789";
type ReadyBootstrap = Extract<BootstrapResult, { kind: "ready" }>;
const longReady: ReadyBootstrap = {
  kind: "ready",
  fixture: true,
  context: { displayName: longText, assignmentReference: longText },
  counts: { tasks: 1, notifications: 1, forms: 1, files: 1 },
  collections: Object.fromEntries(["tasks", "notifications", "forms", "files"].map((key) => [key, {
    title: key,
    fixture: true,
    statuses: [longText],
    items: [{ id: longText, title: longText, status: longText, summary: longText, tab: "active" as const }],
  }])) as ReadyBootstrap["collections"],
};

afterEach(() => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  window.dispatchEvent(new Event("online"));
});

describe("workbench shell", () => {
  it("normalizes inconsistent tab, filter, page and selection URL state", async () => {
    renderApp("/tasks?tab=history&filter=unknown&page=99&selected=fixture-task-02");

    expect(await screen.findByRole("heading", { name: "任务" }, { timeout: 10_000 })).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByTestId("location")).toHaveTextContent("/tasks?tab=history&filter=all&page=1&selected=fixture-task-06"),
      { timeout: 10_000 },
    );
    expect(screen.getByText("fixture-task-06")).toBeInTheDocument();
    expect(screen.queryByText("fixture-task-02")).not.toBeInTheDocument();
  });

  it("uses longest-prefix selection in ProLayout and renders a collection deep link", async () => {
    renderApp("/notifications/fixture-notification-06");

    expect(await screen.findByRole("heading", { name: "通知" })).toBeInTheDocument();
    expect(screen.getByTestId("pro-layout")).toHaveAttribute("data-selected", "/notifications");
    expect(screen.getByTestId("pro-layout")).toHaveAttribute("data-open", "/coordination");
    expect(screen.getByTestId("pro-layout")).toHaveAttribute("data-location", "/notifications");
    expect(screen.getByText("fixture-notification-06")).toBeInTheDocument();
    expect(screen.getByTestId("location")).not.toHaveTextContent("selected=");

    fireEvent.click(screen.getByRole("button", { name: /合成通知 7/u }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/notifications/fixture-notification-07"));
    expect(screen.getByTestId("location")).not.toHaveTextContent("selected=");
    expect(screen.getByText("fixture-notification-07")).toBeInTheDocument();
  });

  it.each([
    ["/coordination", "任务", "/tasks"],
    ["/resources", "表单", "/forms"],
  ])("redirects linked parent path %s to a stable child", async (entry, heading, expectedPath) => {
    renderApp(entry);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(expectedPath));
  });

  it("renders an explicit object not-found state for an unknown deep-link id", async () => {
    renderApp("/tasks/fixture-does-not-exist");

    expect(await screen.findByText("对象不存在")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/tasks/fixture-does-not-exist");
    expect(screen.queryByText("fixture-task-01")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回当前集合" })).toHaveAttribute("href", "/tasks");
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

  it("uses route-appropriate actions for direct status pages", async () => {
    renderApp("/status/403");
    expect(await screen.findByRole("link", { name: "返回工作概览" })).toHaveAttribute("href", "/workspace");
  });

  it("returns expired-session login to the workspace instead of the expired status URL", async () => {
    renderApp("/status/session-expired");
    expect(await screen.findByRole("link", { name: "重新登录" })).toHaveAttribute("href", "/auth/pc/login?returnTo=%2Fworkspace");
  });

  it("leaves a retryable direct status route after a successful refetch", async () => {
    const bootstrap = vi.fn(() => developmentFixturePort.bootstrap());
    renderApp("/status/500", { bootstrap, logout: () => developmentFixturePort.logout() });
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));

    expect(await screen.findByRole("heading", { name: "工作概览" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(bootstrap).toHaveBeenCalled();
  });

  it("fails closed when the runtime adapter reports maintenance", async () => {
    renderApp("/workspace", { bootstrap: vi.fn().mockResolvedValue({ kind: "maintenance" }), logout: vi.fn() });
    expect(await screen.findByText("服务维护中")).toBeInTheDocument();
  });

  it("announces connectivity loss through a semantic live alert", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    renderApp("/workspace");
    await screen.findByRole("heading", { name: "工作概览" });

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
    const notice = await screen.findByText("网络已断开，当前操作不会被视为成功");
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveAttribute("aria-live", "assertive");
    expect(notice).toHaveTextContent("网络已断开，当前操作不会被视为成功");
    expect(notice.nextElementSibling).toHaveClass("connectivity-content-offline");
  });

  it("contains lazy route failures and exposes an explicit recovery action", async () => {
    const recover = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function FailedRoute(): React.JSX.Element {
      throw new Error("synthetic lazy chunk failure");
    }
    render(<RouteErrorBoundary onRecover={recover}><FailedRoute /></RouteErrorBoundary>);

    expect(await screen.findByText("页面资源加载失败。请重新加载工作台；未完成操作不会被视为成功。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(recover).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("constructs only the fixed same-site login entry with a bounded local returnTo", async () => {
    renderApp("/tasks?tab=history", { bootstrap: vi.fn().mockResolvedValue({ kind: "signed-out" }), logout: vi.fn() });
    const login = await screen.findByRole("link", { name: /登录/u });
    expect(login).toHaveAttribute("href", "/auth/pc/login?returnTo=%2Ftasks%3Ftab%3Dhistory");
    expect(normalizeReturnTo("https://outside.invalid/steal")).toBe("/workspace");
    expect(normalizeReturnTo("//outside.invalid/steal")).toBe("/workspace");
    expect(normalizeReturnTo("/safe\\redirect")).toBe("/workspace");
    expect(pcLoginUrl("https://outside.invalid/steal")).toBe("/auth/pc/login?returnTo=%2Fworkspace");
  });

  it("disables logout while pending and converges the session to signed out on success", async () => {
    let resolveLogout: ((value: { kind: "signed-out" }) => void) | undefined;
    const logout = vi.fn(() => new Promise<{ kind: "signed-out" }>((resolve) => { resolveLogout = resolve; }));
    renderApp("/workspace", { bootstrap: () => Promise.resolve(longReady), logout });
    const button = await screen.findByRole("button", { name: "退出当前会话" });

    fireEvent.mouseOver(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("退出当前会话");
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(logout).toHaveBeenCalledTimes(1);
    resolveLogout?.({ kind: "signed-out" });
    expect(await screen.findByText("请登录平台工作台")).toBeInTheDocument();
  });

  it("keeps the session active and exposes a retry when logout fails", async () => {
    const logout = vi.fn().mockRejectedValue(new Error("synthetic failure"));
    renderApp("/workspace", { bootstrap: () => Promise.resolve(longReady), logout });
    fireEvent.click(await screen.findByRole("button", { name: "退出当前会话" }));

    expect(await screen.findByText("退出未完成")).toBeInTheDocument();
    expect(screen.getByText("当前会话仍保持登录。请重试退出操作。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出当前会话" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "重试退出" })).toBeInTheDocument();
  });

  it.each([320, 360])("keeps dynamic long text in bounded elements at %ipx", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    renderApp("/tasks", { bootstrap: () => Promise.resolve(longReady), logout: vi.fn() });

    const title = (await screen.findAllByTitle(longText)).find((element) => element.classList.contains("truncate-text"));
    expect(title).toBeDefined();
    expect(title).toHaveClass("truncate-text");
    expect(screen.getAllByText(longText).some((element) => element.classList.contains("break-text"))).toBe(true);
    expect(screen.getByRole("button", { name: "退出当前会话" })).toHaveAccessibleName("退出当前会话");
  });
});
