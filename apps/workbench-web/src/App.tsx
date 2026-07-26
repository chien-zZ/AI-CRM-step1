import {
  BellOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LoginOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { PageContainer, ProLayout } from "@ant-design/pro-components";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  App as AntdApp,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Empty,
  Flex,
  Pagination,
  Result,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { useEffect } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { navigation } from "./navigation";
import { runtimeWorkbenchPort } from "./runtime";
import type {
  BootstrapResult,
  PlatformCollection,
  PlatformItem,
  WorkbenchPort,
} from "./workbench-port";
import "./styles.css";

const { Text } = Typography;

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

const stateCopy = {
  forbidden: { status: "403", title: "无权访问", detail: "当前会话没有访问此资源的权限。请返回可用工作区。" },
  missing: { status: "404", title: "页面不存在", detail: "链接可能已失效，或应用导航已经更新。" },
  failure: { status: "500", title: "暂时无法加载", detail: "请求未成功。请稍后重试，并保留页面上的安全追踪引用。" },
  offline: { status: "warning", title: "网络已断开", detail: "请检查网络连接。恢复连接后可重试，未完成操作不会被视为成功。" },
  expired: { status: "warning", title: "会话已过期", detail: "为保护账号安全，请重新登录后继续。" },
  maintenance: { status: "info", title: "服务维护中", detail: "平台暂不接收操作，请稍后再试。" },
} as const;

type StateKind = keyof typeof stateCopy;

function SystemState({ kind, onRetry }: { kind: StateKind; onRetry?: () => void }): React.JSX.Element {
  const copy = stateCopy[kind];
  const action = kind === "expired"
    ? <Button type="primary" icon={<LoginOutlined />} href="/bff/login">重新登录</Button>
    : onRetry
      ? <Button type="primary" onClick={onRetry}>重试</Button>
      : <Button type="primary" href="/workspace">返回工作概览</Button>;
  return <Result status={copy.status} title={copy.title} subTitle={copy.detail} extra={action} />;
}

function useCollectionUrlState(): {
  filter: string;
  page: number;
  selected: string | undefined;
  tab: string;
  update: (changes: Record<string, string | undefined>) => void;
} {
  const [params, setParams] = useSearchParams();
  const pageValue = Number(params.get("page") ?? "1");
  return {
    filter: params.get("filter") ?? "all",
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    selected: params.get("selected") ?? undefined,
    tab: params.get("tab") ?? "active",
    update: (changes) => {
      const next = new URLSearchParams(params);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === undefined) next.delete(key);
        else next.set(key, value);
      });
      setParams(next, { replace: true });
    },
  };
}

function CollectionPage({ collection }: { collection: PlatformCollection }): React.JSX.Element {
  const state = useCollectionUrlState();
  const filtered = collection.items.filter((item) => state.filter === "all" || item.status === state.filter);
  const selected = collection.items.find((item) => item.id === state.selected) ?? filtered[0];
  const pageItems = filtered.slice((state.page - 1) * 5, state.page * 5);

  return (
    <PageContainer title={collection.title} subTitle="平台能力视图">
      {collection.fixture && <Alert className="fixture-alert" type="info" showIcon title="开发 Fixture" description="以下内容是合成数据，仅用于开发和测试，不代表生产事实。" />}
      <Flex gap={16} className="master-detail">
        <Card className="collection-list" size="small">
          <Flex vertical gap={12}>
            <Segmented
              aria-label="数据范围"
              value={state.tab}
              options={[{ label: "当前", value: "active" }, { label: "历史", value: "history" }]}
              onChange={(value) => { state.update({ tab: String(value), page: "1" }); }}
            />
            <Select
              aria-label="状态筛选"
              value={state.filter}
              options={[{ label: "全部状态", value: "all" }, ...collection.statuses.map((value) => ({ label: value, value }))]}
              onChange={(value) => { state.update({ filter: value, page: "1", selected: undefined }); }}
            />
            {pageItems.length === 0
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可显示内容" />
              : <div role="list" className="platform-list">
                {pageItems.map((item) => (
                  <div role="listitem" className="platform-list-item" key={item.id}>
                  <button
                    type="button"
                    className={selected?.id === item.id ? "collection-item selected" : "collection-item"}
                    aria-pressed={selected?.id === item.id}
                    onClick={() => { state.update({ selected: item.id }); }}
                  >
                    <Flex justify="space-between" gap={8}>
                      <Text strong>{item.title}</Text>
                      <Tag>{item.status}</Tag>
                    </Flex>
                    <Text type="secondary">{item.summary}</Text>
                  </button>
                  </div>
                ))}
              </div>}
            <Pagination
              current={state.page}
              pageSize={5}
              total={filtered.length}
              onChange={(page) => { state.update({ page: String(page) }); }}
              showSizeChanger={false}
              hideOnSinglePage
            />
          </Flex>
        </Card>
        <Card className="collection-detail" size="small" title="详情">
          {selected ? <ItemDetail item={selected} /> : <Empty description="请选择一项查看详情" />}
        </Card>
      </Flex>
    </PageContainer>
  );
}

function ItemDetail({ item }: { item: PlatformItem }): React.JSX.Element {
  return (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="稳定引用">{item.id}</Descriptions.Item>
      <Descriptions.Item label="名称">{item.title}</Descriptions.Item>
      <Descriptions.Item label="状态">{item.status}</Descriptions.Item>
      <Descriptions.Item label="摘要">{item.summary}</Descriptions.Item>
    </Descriptions>
  );
}

function Overview({ data }: { data: BootstrapResult & { kind: "ready" } }): React.JSX.Element {
  return (
    <PageContainer title="工作概览" subTitle="需要关注的平台协同事项">
      {data.fixture && <Alert className="fixture-alert" type="info" showIcon title="开发 Fixture" description="计数来自合成开发数据，不是业务指标或生产事实。" />}
      <Flex gap={12} wrap="wrap" className="overview-stats">
        <Card size="small"><Statistic title="待查看任务" value={data.counts.tasks} prefix={<ClockCircleOutlined />} /></Card>
        <Card size="small"><Statistic title="未读通知" value={data.counts.notifications} prefix={<BellOutlined />} /></Card>
        <Card size="small"><Statistic title="可用表单" value={data.counts.forms} prefix={<CheckCircleOutlined />} /></Card>
        <Card size="small"><Statistic title="可用文件引用" value={data.counts.files} prefix={<SafetyCertificateOutlined />} /></Card>
      </Flex>
      <Card title="当前任职上下文" size="small" className="context-card">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="显示名称">{data.context.displayName}</Descriptions.Item>
          <Descriptions.Item label="上下文引用">{data.context.assignmentReference}</Descriptions.Item>
        </Descriptions>
      </Card>
    </PageContainer>
  );
}

function SettingsPage(): React.JSX.Element {
  return (
    <PageContainer title="个人设置">
      <Card size="small"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前阶段没有可编辑的个人设置" /></Card>
    </PageContainer>
  );
}

function Shell({ data, port }: { data: BootstrapResult & { kind: "ready" }; port: WorkbenchPort }): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <ProLayout
      title="平台工作台"
      logo={false}
      route={route}
      location={{ pathname: location.pathname }}
      layout="mix"
      splitMenus
      fixedHeader
      fixSiderbar
      menuItemRender={(item, dom) => item.path ? <Link to={item.path}>{dom}</Link> : dom}
      onMenuHeaderClick={() => void navigate("/workspace")}
      avatarProps={{
        src: <Avatar>{data.context.displayName.slice(0, 1)}</Avatar>,
        title: data.context.displayName,
        render: (_props, dom) => <Space>{dom}<Button type="text" aria-label="退出当前会话" icon={<LogoutOutlined />} onClick={() => void port.logout()} /></Space>,
      }}
      contentStyle={{ padding: 0 }}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route path="/workspace" element={<Overview data={data} />} />
        <Route path="/tasks" element={<CollectionPage collection={data.collections.tasks} />} />
        <Route path="/notifications" element={<CollectionPage collection={data.collections.notifications} />} />
        <Route path="/forms" element={<CollectionPage collection={data.collections.forms} />} />
        <Route path="/files" element={<CollectionPage collection={data.collections.files} />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/status/403" element={<SystemState kind="forbidden" />} />
        <Route path="/status/500" element={<SystemState kind="failure" />} />
        <Route path="/status/offline" element={<SystemState kind="offline" />} />
        <Route path="/status/session-expired" element={<SystemState kind="expired" />} />
        <Route path="/status/maintenance" element={<SystemState kind="maintenance" />} />
        <Route path="*" element={<SystemState kind="missing" />} />
      </Routes>
    </ProLayout>
  );
}

function Workbench({ port }: { port: WorkbenchPort }): React.JSX.Element {
  const location = useLocation();
  const query = useQuery({ queryKey: ["workbench-bootstrap"], queryFn: () => port.bootstrap(), retry: false });

  useEffect(() => {
    const setConnectivity = (): void => {
      document.documentElement.dataset.connectivity = navigator.onLine ? "online" : "offline";
    };
    setConnectivity();
    window.addEventListener("online", setConnectivity);
    window.addEventListener("offline", setConnectivity);
    return () => {
      window.removeEventListener("online", setConnectivity);
      window.removeEventListener("offline", setConnectivity);
    };
  }, []);

  if (location.pathname.startsWith("/status/")) {
    const kindByPath: Record<string, StateKind> = {
      "/status/403": "forbidden",
      "/status/500": "failure",
      "/status/offline": "offline",
      "/status/session-expired": "expired",
      "/status/maintenance": "maintenance",
    };
    return <SystemState kind={kindByPath[location.pathname] ?? "missing"} onRetry={() => void query.refetch()} />;
  }
  if (query.isPending) return <Flex className="full-state" align="center" justify="center"><Spin size="large" description="正在恢复会话" /></Flex>;
  if (query.isError) return <SystemState kind="failure" onRetry={() => void query.refetch()} />;
  if (query.data.kind === "signed-out") return <Result title="请登录平台工作台" subTitle="登录由同站点 BFF 发起，浏览器脚本不会接收 Keycloak Token。" extra={<Button type="primary" href={query.data.loginUrl} icon={<LoginOutlined />}>登录</Button>} />;
  if (query.data.kind === "session-expired") return <SystemState kind="expired" />;
  if (query.data.kind === "maintenance") return <SystemState kind="maintenance" onRetry={() => void query.refetch()} />;
  return <Shell data={query.data} port={port} />;
}

export function App({ port = runtimeWorkbenchPort }: { port?: WorkbenchPort }): React.JSX.Element {
  return (
    <ConfigProvider theme={{ token: { colorPrimary: "#1677ff", borderRadius: 6, fontSize: 14, colorBgLayout: "#f4f6f8" } }}>
      <AntdApp><Workbench port={port} /></AntdApp>
    </ConfigProvider>
  );
}
