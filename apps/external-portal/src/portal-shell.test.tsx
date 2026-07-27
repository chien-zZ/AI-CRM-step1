import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PropsWithChildren, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PortalAdapters } from "./adapters";
import type { ExternalPortalPort, PortalBootstrapResult } from "./portal-port";
import { PortalShell } from "./portal-shell";

vi.mock("@tarojs/components", () => ({
  Text: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => <span {...props}>{children}</span>,
  View: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
}));

vi.mock("@nutui/nutui-react-taro", () => ({
  Button: ({ children, onClick, ...props }: PropsWithChildren<{ onClick?: () => void }>) => <button onClick={onClick} {...props}>{children}</button>,
  Empty: ({ description, title }: { description: ReactNode; title: ReactNode }) => <div><div>{title}</div><div>{description}</div></div>,
  NavBar: ({ title }: { title: ReactNode }) => <header>{title}</header>,
  NoticeBar: ({ content }: { content: string }) => <div role="note">{content}</div>,
  Tag: ({ children }: PropsWithChildren) => <span>{children}</span>,
}));

function adapters({ current = Promise.resolve(true), parameters = {}, subscribe = vi.fn(() => vi.fn()) }: { current?: Promise<boolean>; parameters?: Readonly<Record<string, string>>; subscribe?: PortalAdapters["connectivity"]["subscribe"] } = {}): PortalAdapters {
  return {
    platform: "h5",
    session: { target: "h5", credential: () => ({ kind: "h5-cookie" }), clear: vi.fn() },
    connectivity: { current: vi.fn(() => current), subscribe },
    filePicker: { pickImage: vi.fn().mockResolvedValue({ kind: "cancelled" }) },
    navigation: { currentParameters: () => parameters, home: vi.fn().mockResolvedValue(undefined), status: vi.fn().mockResolvedValue(undefined) },
  };
}

const ready: PortalBootstrapResult = {
  kind: "ready",
  fixture: true,
  entries: [{ id: "synthetic-entry", title: "合成入口", summary: "仅验证壳层" }],
};

describe("PortalShell", () => {
  it("renders loading then a synthetic normal state and restores URL view", async () => {
    const ports: ExternalPortalPort = { bootstrap: vi.fn().mockResolvedValue(ready) };
    const target = adapters({ parameters: { view: "boundary" } });
    render(<PortalShell adapters={target} port={ports} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在恢复外部端安全状态");
    expect(await screen.findByText("已实施的客户端边界")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "概览" }));
    expect(target.navigation.home).toHaveBeenCalledWith("overview");
  });

  it("shows denied and contract-pending states without implying resource existence", async () => {
    const denied = { bootstrap: vi.fn().mockResolvedValue({ kind: "denied" }) } satisfies ExternalPortalPort;
    const { unmount } = render(<PortalShell adapters={adapters()} port={denied} />);
    expect(await screen.findByText("当前请求无法继续")).toBeInTheDocument();
    expect(screen.queryByText(/不存在|存在/u)).not.toBeInTheDocument();
    unmount();
    const pending = { bootstrap: vi.fn().mockResolvedValue({ kind: "contract-pending" }) } satisfies ExternalPortalPort;
    render(<PortalShell adapters={adapters()} port={pending} />);
    expect(await screen.findByText("外部能力待确认")).toBeInTheDocument();
  });

  it("moves from offline to ready when connectivity recovers", async () => {
    let networkListener: ((online: boolean) => void) | undefined;
    const subscribe = vi.fn((listener: (online: boolean) => void) => { networkListener = listener; return vi.fn(); });
    const bootstrap = vi.fn().mockResolvedValue(ready);
    render(<PortalShell adapters={adapters({ current: Promise.resolve(false), subscribe })} port={{ bootstrap }} />);
    expect(await screen.findByText("网络已断开")).toBeInTheDocument();
    expect(bootstrap).not.toHaveBeenCalled();
    act(() => { networkListener?.(true); });
    expect(await screen.findByText("合成入口")).toBeInTheDocument();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it("coalesces duplicate load work and recovers after a failed dependency", async () => {
    const bootstrap = vi.fn()
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValueOnce(ready);
    render(<PortalShell adapters={adapters()} port={{ bootstrap }} />);
    expect(await screen.findByText("暂时无法加载")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => { expect(screen.getByText("合成入口")).toBeInTheDocument(); });
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });
});
