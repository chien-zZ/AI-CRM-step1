import { Text, View } from "@tarojs/components";
import { Button, Empty } from "./nutui-adapter";
import type { PortalStatus } from "./portal-port";

const copy: Record<PortalStatus, { detail: string; title: string }> = {
  "contract-pending": { title: "外部能力待确认", detail: "当前没有已批准的外部业务操作，入口保持失败关闭。" },
  denied: { title: "当前请求无法继续", detail: "请返回安全入口；服务端不会通过页面状态授予访问。" },
  empty: { title: "暂无可展示内容", detail: "当前外部壳层没有已确认的业务内容。" },
  offline: { title: "网络已断开", detail: "恢复网络后可重试；未完成操作不会被视为成功。" },
  "session-expired": { title: "会话需要重新建立", detail: "认证入口尚未接入，当前不会伪造外部主体。" },
  unavailable: { title: "暂时无法加载", detail: "依赖当前不可用，请稍后重试。" },
};

export function StatusView({ kind, onHome, onRetry }: { kind: PortalStatus; onHome: () => void; onRetry: () => void }): React.JSX.Element {
  const state = copy[kind];
  return (
    <View className="status-page" role="main" aria-labelledby="status-title">
      <Empty title={<Text id="status-title">{state.title}</Text>} description={state.detail} />
      <View className="status-actions">
        {kind === "offline" || kind === "unavailable" ? <Button type="primary" onClick={onRetry}>重试</Button> : <Button type="primary" onClick={onHome}>返回安全入口</Button>}
      </View>
    </View>
  );
}
