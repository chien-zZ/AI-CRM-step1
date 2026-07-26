import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PropsWithChildren, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReturnTypeOfAdapters } from "../../types-internal";
import { StatusPageContent } from "./index";

vi.mock("../../adapters", () => ({ createTaroH5Adapters: vi.fn() }));

vi.mock("@tarojs/components", () => ({
  View: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
}));

vi.mock("@nutui/nutui-react-taro", () => ({
  Button: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => <button onClick={onClick}>{children}</button>,
  CellGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Empty: ({ description, title }: { description: ReactNode; title: ReactNode }) => <div><div>{title}</div><div>{description}</div></div>,
  NavBar: ({ title }: { title: ReactNode }) => <div>{title}</div>,
  NoticeBar: ({ content }: { content: string }) => <div role="note">{content}</div>,
  Tag: ({ children }: PropsWithChildren) => <span>{children}</span>,
}));

function adapters(): ReturnTypeOfAdapters {
  return {
    navigation: { currentParameters: () => ({ kind: "session-expired" }), navigate: vi.fn().mockResolvedValue(undefined), replace: vi.fn().mockResolvedValue(undefined) },
    connectivity: { current: vi.fn().mockResolvedValue(true), subscribe: vi.fn(() => vi.fn()) },
    filePicker: { pickImage: vi.fn().mockResolvedValue({ kind: "cancelled" }) },
    session: { login: vi.fn(() => ({ kind: "contract-pending" as const })) },
    transport: { request: vi.fn().mockResolvedValue({}) },
  };
}

describe("direct status route", () => {
  it("keeps pending login fail-closed and gives perceptible feedback", () => {
    const context = adapters();
    render(<StatusPageContent adapters={context} kind="session-expired" />);
    fireEvent.click(screen.getByRole("button", { name: "重新登录" }));
    expect(context.session.login).toHaveBeenCalledOnce();
    expect(screen.getByRole("note")).toHaveTextContent("内部移动登录契约尚未接入，当前保持失败关闭。");
  });
});
