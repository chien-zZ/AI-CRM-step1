import { View } from "@tarojs/components";
import { Button, Empty } from "./nutui-adapter";
import type { MobileStatus } from "./workbench-port";

const copy: Record<MobileStatus, { detail: string; title: string }> = {
  forbidden: { title: "无权访问", detail: "当前内部会话没有访问该资源的权限。" },
  maintenance: { title: "移动服务待接入", detail: "内部移动 BFF 与生成 Client 适配尚未完成组合，当前失败关闭。" },
  offline: { title: "网络已断开", detail: "请恢复网络后重试；未完成操作不会被视为成功。" },
  "session-expired": { title: "会话已过期", detail: "请通过受控内部移动登录入口重新建立会话。" },
  unavailable: { title: "暂时无法加载", detail: "依赖暂不可用，请稍后重试。" },
};

export function StatusView({ kind, onHome, onLogin, onRetry }: { kind: MobileStatus; onHome: () => void; onLogin: () => void; onRetry: () => void }): React.JSX.Element {
  const state = copy[kind];
  const action = kind === "session-expired"
    ? <Button type="primary" onClick={onLogin}>重新登录</Button>
    : kind === "forbidden"
      ? <Button type="primary" onClick={onHome}>返回移动首页</Button>
      : <Button type="primary" onClick={onRetry}>重试</Button>;
  return (
    <View className="status-page" role="main" aria-labelledby="status-title">
      <Empty title={<span id="status-title">{state.title}</span>} description={state.detail} />
      <View className="status-action">{action}</View>
    </View>
  );
}
