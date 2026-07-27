import { Text, View } from "@tarojs/components";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PortalAdapters } from "./adapters";
import { createLoadCoordinator } from "./load-coordinator";
import { Button, NavBar, NoticeBar, Tag } from "./nutui-adapter";
import type { ExternalPortalPort, PortalBootstrapResult } from "./portal-port";
import { normalizePortalView } from "./route-state";
import { StatusView } from "./status-view";

export function PortalShell({ adapters, initialParameters, port }: { adapters: PortalAdapters; initialParameters?: Readonly<Record<string, string>>; port: ExternalPortalPort }): React.JSX.Element {
  const [result, setResult] = useState<PortalBootstrapResult | { kind: "loading" }>({ kind: "loading" });
  const [online, setOnline] = useState<boolean>();
  const coordinator = useMemo(() => createLoadCoordinator(() => port.bootstrap()), [port]);
  const parameters = initialParameters ?? adapters.navigation.currentParameters();
  const view = normalizePortalView(parameters["view"]);
  const load = useCallback((): void => {
    if (online !== true) return;
    setResult({ kind: "loading" });
    void coordinator.load().then(setResult);
  }, [coordinator, online]);

  useEffect(() => {
    let active = true;
    let eventSeen = false;
    void adapters.connectivity.current().then(
      (currentOnline) => { if (active && !eventSeen) setOnline(currentOnline); },
      () => { if (active && !eventSeen) setOnline(false); },
    );
    const unsubscribe = adapters.connectivity.subscribe((nextOnline) => { eventSeen = true; setOnline(nextOnline); });
    return () => { active = false; unsubscribe(); };
  }, [adapters.connectivity]);
  useEffect(() => {
    if (online === true) load();
    else {
      coordinator.invalidate();
      setResult({ kind: "loading" });
    }
    return () => { coordinator.invalidate(); };
  }, [coordinator, load, online]);

  if (online === undefined) return <View className="full-state" role="status" aria-live="polite"><Text>正在恢复外部端安全状态</Text></View>;
  if (!online) return <StatusView kind="offline" onHome={() => { void adapters.navigation.home("overview"); }} onRetry={load} />;
  if (result.kind === "loading") return <View className="full-state" role="status" aria-live="polite"><Text>正在恢复外部端安全状态</Text></View>;
  if (result.kind !== "ready") return <StatusView kind={result.kind} onHome={() => { void adapters.navigation.home("overview"); }} onRetry={load} />;
  if (result.entries.length === 0) return <StatusView kind="empty" onHome={() => { void adapters.navigation.home("overview"); }} onRetry={load} />;

  return (
    <View className="portal-app">
      <NoticeBar content="当前仅展示开发/测试合成 Fixture，不代表已开放的外部业务能力。" />
      <NavBar title="外部服务安全入口" safeAreaInsetTop fixed={false} />
      <View className="portal-navigation" role="navigation" aria-label="外部端壳层导航">
        <Button size="small" fill={view === "overview" ? "solid" : "outline"} onClick={() => { void adapters.navigation.home("overview"); }}>概览</Button>
        <Button size="small" fill={view === "boundary" ? "solid" : "outline"} onClick={() => { void adapters.navigation.home("boundary"); }}>安全边界</Button>
      </View>
      <View className="portal-content" role="main">
        {view === "overview" ? (
          <View aria-labelledby="portal-heading">
            <View className="hero-card"><Text id="portal-heading" className="hero-title">业务中立外部端壳层</Text><Text className="hero-copy">访问模式尚未由 owning domain 选择，当前不会创建匿名、邀请或登录业务入口。</Text></View>
            <View className="entry-grid">
              {result.entries.map((entry) => <View className="entry-card" key={entry.id}><Tag type="primary">合成</Tag><Text className="entry-title">{entry.title}</Text><Text className="entry-summary">{entry.summary}</Text></View>)}
            </View>
          </View>
        ) : (
          <View aria-labelledby="boundary-heading" className="boundary-card">
            <Text id="boundary-heading" className="hero-title">已实施的客户端边界</Text>
            <Text>当前目标：{adapters.platform === "weapp" ? "微信小程序" : "H5"}</Text>
            <Text>H5 仅依赖 BFF HttpOnly Cookie；小程序只允许不透明会话句柄。</Text>
            <Text>生成的 external client 当前没有业务 operation，所有未知调用在网络前拒绝。</Text>
          </View>
        )}
      </View>
    </View>
  );
}
