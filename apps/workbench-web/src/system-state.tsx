import { Button, Result } from "antd";

export const stateCopy = {
  forbidden: { status: "403", title: "无权访问", detail: "当前会话没有访问此资源的权限。请返回可用工作区。" },
  missing: { status: "404", title: "页面不存在", detail: "链接可能已失效，或应用导航已经更新。" },
  failure: { status: "500", title: "暂时无法加载", detail: "请求未成功。请稍后重试，并保留页面上的安全追踪引用。" },
  offline: { status: "warning", title: "网络已断开", detail: "请检查网络连接。恢复连接后可重试，未完成操作不会被视为成功。" },
  expired: { status: "warning", title: "会话已过期", detail: "为保护账号安全，请重新登录后继续。" },
  maintenance: { status: "info", title: "服务维护中", detail: "平台暂不接收操作，请稍后再试。" },
} as const;

export type StateKind = keyof typeof stateCopy;

export function SystemState({ kind, loginUrl, onRetry, retryable = false }: { kind: StateKind; loginUrl?: string; onRetry?: () => void; retryable?: boolean }): React.JSX.Element {
  const copy = stateCopy[kind];
  const action = kind === "expired"
    ? <Button type="primary" href={loginUrl ?? "/auth/pc/login"}>重新登录</Button>
    : retryable && onRetry
      ? <Button type="primary" onClick={onRetry}>重试</Button>
      : <Button type="primary" href="/workspace">返回工作概览</Button>;
  return <Result status={copy.status} title={copy.title} subTitle={copy.detail} extra={action} />;
}
