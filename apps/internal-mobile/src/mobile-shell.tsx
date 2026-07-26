import { Text, View } from "@tarojs/components";
import { useEffect, useMemo, useState } from "react";
import { Button, CellGroup, NavBar, NoticeBar, Tag } from "./nutui-adapter";
import type { ReturnTypeOfAdapters } from "./types-internal";
import { normalizeRouteState, sectionPath } from "./route-state";
import { StatusView } from "./status-view";
import type { InternalMobilePort, MobileBootstrapResult, MobileSection, MobileStatus, ReadyMobileBootstrap } from "./workbench-port";

const labels: Record<MobileSection, string> = { home: "首页", tasks: "任务", notifications: "通知", forms: "表单" };

function CollectionView({ adapters, data, parameters, section }: { adapters: ReturnTypeOfAdapters; data: ReadyMobileBootstrap; parameters: Readonly<Record<string, string>>; section: Exclude<MobileSection, "home"> }): React.JSX.Element {
  const items = data.collections[section];
  const route = useMemo(() => normalizeRouteState(parameters, items.map((item) => item.id)), [items, parameters]);
  const visible = items.slice((route.page - 1) * 3, route.page * 3);

  useEffect(() => {
    const canonical = sectionPath(section, route);
    const requestedPage = parameters["page"] ?? "1";
    if (requestedPage !== String(route.page) || parameters["selected"] !== route.selected) void adapters.navigation.replace(canonical);
  }, [adapters.navigation, parameters, route, section]);

  return (
    <View aria-labelledby="collection-heading">
      <View className="section-heading">
        <Text id="collection-heading" className="section-title">{labels[section]}</Text>
        <Text className="section-caption">只读业务中立投影</Text>
      </View>
      <CellGroup>
        {visible.map((item) => (
          <button
            aria-pressed={route.selected === item.id}
            className="collection-action"
            key={item.id}
            type="button"
            onClick={() => { void adapters.navigation.replace(sectionPath(section, { page: route.page, selected: item.id })); }}
          >
            <span className="collection-copy"><strong>{item.title}</strong><span>{item.summary}</span></span>
            <Tag type={route.selected === item.id ? "primary" : "default"}>{item.status}</Tag>
          </button>
        ))}
      </CellGroup>
      {visible.length === 0 && <View role="status"><Text>当前没有可显示的合成数据。</Text></View>}
      <View className="pagination" aria-label={`${labels[section]}分页`}>
        <Button size="small" disabled={route.page <= 1} onClick={() => { void adapters.navigation.replace(sectionPath(section, { page: route.page - 1 })); }}>上一页</Button>
        <Text aria-live="polite">第 {route.page} 页</Text>
        <Button size="small" disabled={route.page * 3 >= items.length} onClick={() => { void adapters.navigation.replace(sectionPath(section, { page: route.page + 1 })); }}>下一页</Button>
      </View>
      {route.selected !== undefined && <View className="selection-detail" role="region" aria-label="当前选择"><Text className="break-text">稳定引用：{route.selected}</Text></View>}
    </View>
  );
}

function HomeView({ adapters, data }: { adapters: ReturnTypeOfAdapters; data: ReadyMobileBootstrap }): React.JSX.Element {
  return (
    <View aria-labelledby="home-heading">
      <View className="section-heading"><Text id="home-heading" className="section-title">移动工作概览</Text><Text className="section-caption break-text">{data.contextLabel}</Text></View>
      <View className="metric-grid">
        {(["tasks", "notifications", "forms"] as const).map((section) => (
          <button className="metric-card" key={section} type="button" onClick={() => { void adapters.navigation.navigate(sectionPath(section)); }}>
            <span>{labels[section]}</span><strong>{data.collections[section].length}</strong>
          </button>
        ))}
      </View>
      <View className="boundary-card"><Text className="boundary-title">安全边界</Text><Text>H5 仅使用独立 BFF HttpOnly Cookie；客户端不接收 Keycloak Token。文件选择返回临时本地引用，不代表上传成功。</Text></View>
    </View>
  );
}

export function MobileShell({ adapters, initialParameters, port, section }: { adapters: ReturnTypeOfAdapters; initialParameters?: Readonly<Record<string, string>>; port: InternalMobilePort; section: MobileSection }): React.JSX.Element {
  const [result, setResult] = useState<MobileBootstrapResult | { kind: "loading" }>({ kind: "loading" });
  const [online, setOnline] = useState<boolean>();
  const [loginPending, setLoginPending] = useState(false);
  const parameters = initialParameters ?? adapters.navigation.currentParameters();
  const load = (): void => { setResult({ kind: "loading" }); port.bootstrap().then(setResult, () => { setResult({ kind: "unavailable" }); }); };

  useEffect(load, [port]);
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

  if (result.kind === "loading" || online === undefined) return <View className="full-state" role="status" aria-live="polite"><Text>正在恢复内部移动会话</Text></View>;
  if (result.kind !== "ready") {
    const status: MobileStatus = online ? result.kind : "offline";
    return (
      <View className="status-shell">
        {loginPending && <NoticeBar content="内部移动登录契约尚未接入，当前保持失败关闭。" />}
        <StatusView kind={status} onHome={() => { void adapters.navigation.replace(sectionPath("home")); }} onRetry={load} onLogin={() => { adapters.session.login(); setLoginPending(true); }} />
      </View>
    );
  }

  return (
    <View className="mobile-app">
      {!online && <View className="offline-alert" role="alert" aria-live="assertive">网络已断开，当前操作不会被视为成功</View>}
      {result.fixture && <NoticeBar content="当前展示开发/测试合成 Fixture，不代表生产事实。" />}
      <NavBar title="内部移动工作区" safeAreaInsetTop fixed={false} />
      <View className="mobile-content">
        <View className="mobile-navigation" role="navigation" aria-label="内部移动主导航">
          {(Object.keys(labels) as MobileSection[]).map((item) => <Button key={item} fill={section === item ? "solid" : "outline"} size="small" onClick={() => { void adapters.navigation.navigate(sectionPath(item)); }}>{labels[item]}</Button>)}
        </View>
        <main>{section === "home" ? <HomeView adapters={adapters} data={result} /> : <CollectionView adapters={adapters} data={result} parameters={parameters} section={section} />}</main>
        <View className="session-footer"><Button fill="none" onClick={() => { port.logout().then((logout) => { setResult({ kind: logout.kind === "signed-out" ? "session-expired" : logout.kind }); }, () => { setResult({ kind: "unavailable" }); }); }}>退出当前会话</Button></View>
      </View>
    </View>
  );
}
