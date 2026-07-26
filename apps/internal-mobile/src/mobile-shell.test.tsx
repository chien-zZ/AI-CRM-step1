import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PropsWithChildren, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReturnTypeOfAdapters } from "./types-internal";
import { MobileShell } from "./mobile-shell";
import type { InternalMobilePort, MobileBootstrapResult, ReadyMobileBootstrap } from "./workbench-port";

vi.mock("@tarojs/components", () => ({
  Text: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => <span {...props}>{children}</span>,
  View: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
}));

vi.mock("@nutui/nutui-react-taro", () => ({
  Button: ({ children, onClick, ...props }: PropsWithChildren<{ onClick?: () => void }>) => <button onClick={onClick} {...props}>{children}</button>,
  CellGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Empty: ({ description, title }: { description: ReactNode; title: ReactNode }) => <div><div>{title}</div><div>{description}</div></div>,
  NavBar: ({ title }: { title: ReactNode }) => <header>{title}</header>,
  NoticeBar: ({ content }: { content: string }) => <div role="note">{content}</div>,
  Tag: ({ children }: PropsWithChildren) => <span>{children}</span>,
}));

const ready: ReadyMobileBootstrap = {
  kind: "ready",
  fixture: true,
  contextLabel: "合成内部上下文",
  collections: {
    tasks: [
      { id: "task-1", title: "合成任务 1", summary: "仅供测试", status: "待处理" },
      { id: "task-2", title: "合成任务 2", summary: "仅供测试", status: "可查看" },
      { id: "task-3", title: "合成任务 3", summary: "仅供测试", status: "可查看" },
      { id: "task-4", title: "合成任务 4", summary: "仅供测试", status: "可查看" },
    ],
    notifications: [],
    forms: [],
  },
};

function setup(result: MobileBootstrapResult = ready, parameters: Readonly<Record<string, string>> = {}, initiallyOnline: boolean | Promise<boolean> = true): {
  adapters: ReturnTypeOfAdapters;
  emitNetwork: (online: boolean) => void;
  port: InternalMobilePort;
} {
  let networkListener: ((online: boolean) => void) | undefined;
  const adapters: ReturnTypeOfAdapters = {
    navigation: {
      currentParameters: () => parameters,
      navigate: vi.fn().mockResolvedValue(undefined),
      replace: vi.fn().mockResolvedValue(undefined),
    },
    connectivity: {
      current: vi.fn(() => Promise.resolve(initiallyOnline)),
      subscribe: vi.fn((listener: (online: boolean) => void) => {
        networkListener = listener;
        return vi.fn();
      }),
    },
    filePicker: { pickImage: vi.fn().mockResolvedValue({ kind: "cancelled" }) },
    session: { login: vi.fn(() => ({ kind: "contract-pending" as const })) },
    transport: { request: vi.fn().mockResolvedValue({}) },
  };
  const port: InternalMobilePort = {
    bootstrap: vi.fn().mockResolvedValue(result),
    logout: vi.fn().mockResolvedValue({ kind: "signed-out" }),
  };
  return {
    adapters,
    port,
    emitNetwork: (online) => { networkListener?.(online); },
  };
}

describe("internal mobile shell", () => {
  it("moves from loading to a business-neutral ready shell and navigates explicit routes", async () => {
    const context = setup();
    render(<MobileShell adapters={context.adapters} port={context.port} section="home" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在恢复内部移动会话");
    expect(await screen.findByText("移动工作概览")).toBeInTheDocument();
    expect(screen.getByText("当前展示开发/测试合成 Fixture，不代表生产事实。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /任务\s*4/ }));
    expect(context.adapters.navigation.navigate).toHaveBeenCalledWith("/pages/tasks/index?page=1");
  });

  it("canonicalizes invalid URL state and restores a valid selection", async () => {
    const invalid = setup(ready, { page: "99", selected: "missing" });
    const { unmount } = render(<MobileShell adapters={invalid.adapters} port={invalid.port} section="tasks" />);
    expect(await screen.findByText("合成任务 4")).toBeInTheDocument();
    await waitFor(() => { expect(invalid.adapters.navigation.replace).toHaveBeenCalledWith("/pages/tasks/index?page=2"); });
    unmount();

    const restored = setup(ready, { page: "2", selected: "task-4" });
    render(<MobileShell adapters={restored.adapters} port={restored.port} section="tasks" />);
    expect(await screen.findByText("稳定引用：task-4")).toBeInTheDocument();
  });

  it("announces offline state and recovers when connectivity returns", async () => {
    const context = setup();
    render(<MobileShell adapters={context.adapters} port={context.port} section="home" />);
    await screen.findByText("移动工作概览");
    context.emitNetwork(false);
    expect(await screen.findByRole("alert")).toHaveTextContent("网络已断开");
    context.emitNetwork(true);
    await waitFor(() => { expect(screen.queryByRole("alert")).not.toBeInTheDocument(); });
  });

  it("fails closed as offline when the application starts without a change event", async () => {
    const context = setup(ready, {}, false);
    render(<MobileShell adapters={context.adapters} port={context.port} section="home" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("网络已断开");
  });

  it("does not let a stale initial network query overwrite a newer change event", async () => {
    let resolveInitial: ((online: boolean) => void) | undefined;
    const initial = new Promise<boolean>((resolve) => { resolveInitial = resolve; });
    const context = setup(ready, {}, initial);
    render(<MobileShell adapters={context.adapters} port={context.port} section="home" />);
    await act(async () => {
      context.emitNetwork(false);
      resolveInitial?.(true);
      await initial;
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("网络已断开");
  });

  it("renders collection choices as native keyboard-focusable buttons", async () => {
    const context = setup();
    render(<MobileShell adapters={context.adapters} port={context.port} section="tasks" />);
    const choice = await screen.findByRole("button", { name: /合成任务 1.*仅供测试.*待处理/ });
    expect(choice.tagName).toBe("BUTTON");
    expect(choice).toHaveAttribute("type", "button");
    expect(choice.tabIndex).toBe(0);
    fireEvent.click(choice);
    expect(context.adapters.navigation.replace).toHaveBeenCalledWith("/pages/tasks/index?page=1&selected=task-1");
  });

  it.each([
    ["forbidden", "无权访问"],
    ["maintenance", "移动服务待接入"],
    ["session-expired", "会话已过期"],
    ["unavailable", "暂时无法加载"],
  ] as const)("renders the %s failure state", async (kind, title) => {
    const context = setup({ kind });
    render(<MobileShell adapters={context.adapters} port={context.port} section="home" />);
    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it("retries dependency failures and keeps pending login fail-closed", async () => {
    const context = setup({ kind: "unavailable" });
    vi.mocked(context.port.bootstrap).mockResolvedValueOnce({ kind: "unavailable" }).mockResolvedValueOnce(ready);
    const { rerender } = render(<MobileShell adapters={context.adapters} port={context.port} section="home" />);
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    expect(await screen.findByText("移动工作概览")).toBeInTheDocument();

    const expired = setup({ kind: "session-expired" });
    rerender(<MobileShell adapters={expired.adapters} port={expired.port} section="home" />);
    fireEvent.click(await screen.findByRole("button", { name: "重新登录" }));
    expect(expired.adapters.session.login).toHaveBeenCalledOnce();
    expect(screen.getByText("内部移动登录契约尚未接入，当前保持失败关闭。")).toBeInTheDocument();
  });

  it("converges logout to an expired session and exposes accessible landmarks", async () => {
    const context = setup();
    render(<MobileShell adapters={context.adapters} port={context.port} section="home" />);
    expect(await screen.findByRole("navigation", { name: "内部移动主导航" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出当前会话" }));
    expect(await screen.findByText("会话已过期")).toBeInTheDocument();
  });
});
