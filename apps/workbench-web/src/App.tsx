import { LoginOutlined, LogoutOutlined } from "@ant-design/icons";
import { ProLayout } from "@ant-design/pro-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntdApp, Avatar, Button, ConfigProvider, Flex, Result, Space, Spin, Tooltip } from "antd";
import { Component, lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getNavigationSelection, navigation } from "./navigation";
import { runtimeWorkbenchPort } from "./runtime";
import { stateCopy, SystemState } from "./system-state";
import type { BootstrapResult, PlatformCollection, WorkbenchPort } from "./workbench-port";
import "./styles.css";

const CollectionPage = lazy(async () => ({ default: (await import("./pages")).CollectionPage }));
const Overview = lazy(async () => ({ default: (await import("./overview-page")).Overview }));
const SettingsPage = lazy(async () => ({ default: (await import("./settings-page")).SettingsPage }));
const StatusRoutePage = lazy(async () => ({ default: (await import("./status-route-page")).StatusRoutePage }));

const route = {
  path: "/",
  routes: navigation.map((item) => ({
    path: item.key,
    name: item.label,
    icon: item.icon,
    ...(item.children
      ? { routes: item.children.map((child) => ({ path: child.key, name: child.label, icon: child.icon })) }
      : {}),
  })),
};

type StateKind = "expired" | "failure" | "forbidden" | "maintenance" | "missing" | "offline";

export class RouteErrorBoundary extends Component<
  { children: ReactNode; onRecover?: () => void },
  { failed: boolean }
> {
  public override state = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public override componentDidCatch(): void {
    // Error details are intentionally not rendered or logged from the browser shell.
  }

  public override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const recover = this.props.onRecover ?? (() => { window.location.reload(); });
    return (
      <Result
        status="500"
        title="暂时无法加载"
        subTitle="页面资源加载失败。请重新加载工作台；未完成操作不会被视为成功。"
        extra={<Button type="primary" onClick={recover}>重新加载</Button>}
      />
    );
  }
}

function ConnectivityFrame({ children }: { children: ReactNode }): React.JSX.Element {
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const setConnectivity = (): void => {
      const nextOffline = !navigator.onLine;
      document.documentElement.dataset.connectivity = nextOffline ? "offline" : "online";
      setOffline(nextOffline);
    };
    setConnectivity();
    window.addEventListener("online", setConnectivity);
    window.addEventListener("offline", setConnectivity);
    return () => {
      window.removeEventListener("online", setConnectivity);
      window.removeEventListener("offline", setConnectivity);
    };
  }, []);

  return (
    <>
      {offline && <div className="connectivity-alert" role="alert" aria-live="assertive">网络已断开，当前操作不会被视为成功</div>}
      <div className={offline ? "connectivity-content-offline" : undefined}>{children}</div>
    </>
  );
}

function DirectSystemState({ kind, onRetry }: { kind: StateKind; onRetry?: () => void }): React.JSX.Element {
  const copy = stateCopy[kind];
  const action = kind === "expired"
    ? <Button type="primary" href={pcLoginUrl("/workspace")}>重新登录</Button>
    : onRetry
      ? <Button type="primary" onClick={onRetry}>重试</Button>
      : <Button type="primary" href="/workspace">返回工作概览</Button>;
  return <Result status={copy.status} title={copy.title} subTitle={copy.detail} extra={action} />;
}

export function normalizeReturnTo(candidate: string): string {
  if (candidate.length === 0 || candidate.length > 512 || !candidate.startsWith("/") || candidate.startsWith("//") || /[\0\r\n\\]/u.test(candidate)) {
    return "/workspace";
  }
  return candidate;
}

export function pcLoginUrl(returnTo: string): string {
  const params = new URLSearchParams({ returnTo: normalizeReturnTo(returnTo) });
  return `/auth/pc/login?${params.toString()}`;
}

function CollectionRoutes({ path, collection }: { path: string; collection: PlatformCollection }): React.JSX.Element[] {
  return [
    <Route key={path} path={path} element={<CollectionPage collection={collection} />} />,
    <Route key={`${path}/:itemId`} path={`${path}/:itemId`} element={<CollectionPage collection={collection} />} />,
  ];
}

function Shell({ data, port }: { data: BootstrapResult & { kind: "ready" }; port: WorkbenchPort }): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [logoutState, setLogoutState] = useState<"error" | "idle" | "pending">("idle");
  const selection = getNavigationSelection(location.pathname);

  const requestLogout = (): void => {
    if (logoutState === "pending") return;
    setLogoutState("pending");
    port.logout().then(
      (result) => { queryClient.setQueryData(["workbench-bootstrap"], result); },
      () => { setLogoutState("error"); },
    );
  };

  return (
    <ProLayout
      title="平台工作台"
      logo={false}
      route={route}
      location={{ pathname: selection.selectedKey ?? location.pathname }}
      layout="mix"
      splitMenus
      fixedHeader
      fixSiderbar
      token={{ header: { heightLayoutHeader: 48 } }}
      siderWidth={184}
      contentWidth="Fluid"
      openKeys={selection.openKeys}
      menuProps={{ selectedKeys: selection.selectedKey === undefined ? [] : [selection.selectedKey] }}
      menuItemRender={(item, dom) => item.path ? <Link to={item.path}>{dom}</Link> : dom}
      onMenuHeaderClick={() => { void navigate("/workspace"); }}
      avatarProps={{
        src: <Avatar>{data.context.displayName.slice(0, 1)}</Avatar>,
        title: <span className="header-display-name" title={data.context.displayName}>{data.context.displayName}</span>,
        render: (_props, dom) => (
          <Space className="session-controls">
            {dom}
            <Tooltip title={logoutState === "pending" ? "正在退出当前会话" : "退出当前会话"}>
              <Button
                type="text"
                aria-label="退出当前会话"
                icon={<LogoutOutlined />}
                loading={logoutState === "pending"}
                disabled={logoutState === "pending"}
                onClick={requestLogout}
              />
            </Tooltip>
          </Space>
        ),
      }}
      contentStyle={{ padding: 0 }}
    >
      {logoutState === "error" && (
        <Alert
          className="logout-alert"
          type="error"
          showIcon
          title="退出未完成"
          description="当前会话仍保持登录。请重试退出操作。"
          action={<Button size="small" danger onClick={requestLogout}>重试退出</Button>}
        />
      )}
      <Routes>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route path="/coordination" element={<Navigate to="/tasks" replace />} />
        <Route path="/resources" element={<Navigate to="/forms" replace />} />
        <Route path="/workspace" element={<Overview data={data} />} />
        {CollectionRoutes({ path: "/tasks", collection: data.collections.tasks })}
        {CollectionRoutes({ path: "/notifications", collection: data.collections.notifications })}
        {CollectionRoutes({ path: "/forms", collection: data.collections.forms })}
        {CollectionRoutes({ path: "/files", collection: data.collections.files })}
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/status/403" element={<StatusRoutePage kind="forbidden" />} />
        <Route path="/status/500" element={<StatusRoutePage kind="failure" />} />
        <Route path="/status/offline" element={<StatusRoutePage kind="offline" />} />
        <Route path="/status/session-expired" element={<StatusRoutePage kind="expired" loginUrl={pcLoginUrl(location.pathname + location.search)} />} />
        <Route path="/status/maintenance" element={<StatusRoutePage kind="maintenance" />} />
        <Route path="*" element={<StatusRoutePage kind="missing" />} />
      </Routes>
    </ProLayout>
  );
}

function Workbench({ port }: { port: WorkbenchPort }): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["workbench-bootstrap"], queryFn: () => port.bootstrap(), retry: false });

  const retry = (): void => { query.refetch().catch(() => undefined); };
  const retryStatus = (): void => {
    query.refetch().then(
      (result) => { if (!result.isError) void navigate("/workspace", { replace: true }); },
      () => undefined,
    );
  };
  const returnTo = location.pathname + location.search + location.hash;
  if (location.pathname.startsWith("/status/")) {
    const kindByPath: Record<string, StateKind> = {
      "/status/403": "forbidden",
      "/status/500": "failure",
      "/status/offline": "offline",
      "/status/session-expired": "expired",
      "/status/maintenance": "maintenance",
    };
    const kind = kindByPath[location.pathname] ?? "missing";
    const retryable = kind === "failure" || kind === "maintenance" || kind === "offline";
    if (retryable) {
      const copy = stateCopy[kind];
      return (
        <div className="direct-system-state">
          <Result status={copy.status} title={copy.title} subTitle={copy.detail} />
          <div className="direct-system-state-action"><button className="direct-retry-button" type="button" onClick={retryStatus}>重试</button></div>
        </div>
      );
    }
    return <DirectSystemState kind={kind} />;
  }
  if (query.isPending) return <Flex className="full-state" align="center" justify="center"><Spin size="large" description="正在恢复会话" /></Flex>;
  if (query.isError) return <SystemState kind="failure" retryable onRetry={retry} />;
  if (query.data.kind === "signed-out") {
    return <Result title="请登录平台工作台" subTitle="登录由同站点 BFF 发起，浏览器脚本不会接收 Keycloak Token。" extra={<Button type="primary" href={pcLoginUrl(returnTo)} icon={<LoginOutlined />}>登录</Button>} />;
  }
  if (query.data.kind === "session-expired") return <SystemState kind="expired" loginUrl={pcLoginUrl(returnTo)} />;
  if (query.data.kind === "maintenance") return <SystemState kind="maintenance" retryable onRetry={retry} />;
  return <Shell data={query.data} port={port} />;
}

export function App({ port = runtimeWorkbenchPort }: { port?: WorkbenchPort }): React.JSX.Element {
  return (
    <ConfigProvider theme={{ token: { colorPrimary: "#1677ff", borderRadius: 6, fontSize: 14, colorBgLayout: "#f4f6f8" } }}>
      <AntdApp>
        <ConnectivityFrame>
          <RouteErrorBoundary>
            <Suspense fallback={<Flex className="full-state" align="center" justify="center"><Spin size="large" description="正在加载工作区" /></Flex>}>
              <Workbench port={port} />
            </Suspense>
          </RouteErrorBoundary>
        </ConnectivityFrame>
      </AntdApp>
    </ConfigProvider>
  );
}
