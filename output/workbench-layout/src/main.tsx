import {
  AppstoreOutlined,
  BgColorsOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  FileOutlined,
  FormOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Col,
  ConfigProvider,
  Dropdown,
  Empty,
  Flex,
  Input,
  Layout,
  Menu,
  Popover,
  Row,
  Segmented,
  Select,
  Switch,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const { Header, Sider, Content } = Layout;
const { Text, Title } = Typography;

type PrimaryKey = "workspace" | "coordination" | "resources" | "states" | "settings";

const primaryItems = [
  { key: "workspace" as const, label: "工作台", icon: <HomeOutlined /> },
  { key: "coordination" as const, label: "协同", icon: <CheckSquareOutlined /> },
  { key: "resources" as const, label: "平台资源", icon: <AppstoreOutlined /> },
  { key: "states" as const, label: "系统状态", icon: <SafetyCertificateOutlined /> },
  { key: "settings" as const, label: "设置", icon: <SettingOutlined /> },
];

const secondaryItems: Record<PrimaryKey, Array<{ key: string; label: string; icon: React.ReactNode }>> = {
  workspace: [
    { key: "overview", label: "工作台首页", icon: <HomeOutlined /> },
    { key: "recent", label: "最近访问", icon: <ClockCircleOutlined /> },
  ],
  coordination: [
    { key: "tasks", label: "统一任务", icon: <CheckSquareOutlined /> },
    { key: "notifications", label: "站内通知", icon: <BellOutlined /> },
  ],
  resources: [
    { key: "forms", label: "表单", icon: <FormOutlined /> },
    { key: "files", label: "文件", icon: <FileOutlined /> },
  ],
  states: [
    { key: "runtime", label: "运行状态", icon: <CheckCircleOutlined /> },
    { key: "exceptions", label: "异常页面", icon: <SafetyCertificateOutlined /> },
  ],
  settings: [
    { key: "profile", label: "个人信息", icon: <UserOutlined /> },
    { key: "preferences", label: "界面偏好", icon: <SettingOutlined /> },
  ],
};

const stats = [
  { label: "待处理任务", value: 8 },
  { label: "未读通知", value: 5 },
  { label: "可用表单", value: 12 },
  { label: "处理中引用", value: 2, color: "#fa8c16" },
  { label: "已注册应用", value: 3 },
];

const todoGroups = [
  {
    key: "coordination",
    label: "任务处理",
    count: 6,
    items: [
      { id: "T-0718", title: "检查测试流程提交材料", desc: "平台测试流程", avatar: "检", color: "#eb2f96", time: "今天 16:30", state: "待处理", stateColor: "orange" },
      { id: "T-0715", title: "确认文件扫描结果", desc: "文件中心", avatar: "文", color: "#f56a00", time: "今天 18:00", state: "处理中", stateColor: "processing" },
      { id: "T-0709", title: "复核版本化表单内容", desc: "表单中心", avatar: "表", color: "#7265e6", time: "明天 10:00", state: "待处理", stateColor: "orange" },
      { id: "T-0703", title: "完成工作流测试节点", desc: "统一任务", avatar: "流", color: "#13c2c2", time: "7 月 31 日", state: "待处理", stateColor: "default" },
      { id: "T-0699", title: "复核任务投影更新", desc: "任务中心", avatar: "任", color: "#ffbf00", time: "8 月 1 日", state: "待处理", stateColor: "default" },
      { id: "T-0694", title: "检查通知轮询结果", desc: "通知中心", avatar: "轮", color: "#1677ff", time: "8 月 1 日", state: "处理中", stateColor: "processing" },
    ],
  },
  {
    key: "resources",
    label: "资源确认",
    count: 4,
    items: [
      { id: "T-0698", title: "确认通知接收范围", desc: "通知中心", avatar: "通", color: "#52c41a", time: "8 月 1 日", state: "待处理", stateColor: "default" },
      { id: "T-0686", title: "验证表单服务端校验", desc: "表单中心", avatar: "验", color: "#1677ff", time: "8 月 2 日", state: "处理中", stateColor: "processing" },
      { id: "T-0677", title: "确认文件稳定引用", desc: "文件中心", avatar: "引", color: "#eb2f96", time: "8 月 2 日", state: "待处理", stateColor: "default" },
      { id: "T-0668", title: "检查应用注册结果", desc: "应用注册", avatar: "应", color: "#722ed1", time: "8 月 3 日", state: "待处理", stateColor: "default" },
    ],
  },
];

const activities = [
  { color: "green", content: <><strong>文件扫描已完成</strong><Text type="secondary">测试文件引用可以继续用于后续流程</Text><small>今天 11:32 · 文件中心</small></> },
  { color: "blue", content: <><strong>新任务已分配</strong><Text type="secondary">检查测试流程提交材料</Text><small>今天 10:48 · 统一任务</small></> },
  { color: "green", content: <><strong>表单版本已发布</strong><Text type="secondary">合成登记表 v3</Text><small>今天 09:25 · 表单中心</small></> },
];

function ThemePanel({ dark, compact, onDarkChange, onCompactChange }: { dark: boolean; compact: boolean; onDarkChange: (value: boolean) => void; onCompactChange: (value: boolean) => void }) {
  return (
    <div className="theme-panel">
      <Text type="secondary">预设主题</Text>
      <Segmented block value={dark ? "dark" : "light"} options={[{ label: "默认浅色", value: "light" }, { label: "默认深色", value: "dark" }]} onChange={(value) => onDarkChange(value === "dark")} />
      <Flex align="center" justify="space-between"><div><Text>紧凑模式</Text><Text type="secondary">一屏显示更多内容</Text></div><Switch checked={compact} onChange={onCompactChange} /></Flex>
    </div>
  );
}

function StatRow() {
  return (
    <Flex className="stat-row" gap={16}>
      {stats.map((item) => (
        <Card key={item.label} size="small" className="stat-card" styles={{ body: { padding: "10px 8px" } }}>
          <div className="stat-value" style={{ color: item.color }}>{item.value}</div>
          <Text type="secondary">{item.label}</Text>
        </Card>
      ))}
    </Flex>
  );
}

function TodoCard({ compact }: { compact: boolean }) {
  const [mode, setMode] = useState("action");
  return (
    <Card
      size="small"
      className="todo-card"
      title={<span>今日待办（{todoGroups.reduce((sum, group) => sum + group.count, 0)}）</span>}
      extra={<Select size="small" value={mode} style={{ width: 104 }} options={[{ label: "按动作", value: "action" }, { label: "按状态", value: "state" }]} onChange={setMode} />}
      styles={{ body: { padding: "4px 0" } }}
    >
      {todoGroups.map((group) => (
        <section className="todo-group" key={group.key}>
          <Flex className="todo-group-title" align="center" gap={8}><Text strong>{group.label}</Text><Badge count={group.count} /></Flex>
          {group.items.map((item) => (
            <button className={compact ? "todo-row compact" : "todo-row"} key={item.id} type="button">
              <Avatar size={32} style={{ background: item.color }}>{item.avatar}</Avatar>
              <span className="todo-main"><span><strong>{item.title}</strong><Text type="secondary">{item.desc}</Text></span><small>{item.id}</small></span>
              <span className="todo-time"><CalendarOutlined /> {item.time}</span>
              <Tag color={item.stateColor}>{item.state}</Tag>
              <RightOutlined />
            </button>
          ))}
        </section>
      ))}
    </Card>
  );
}

function WorkspaceHome({ compact }: { compact: boolean }) {
  return (
    <div className="workspace-home">
      <Flex className="page-title-row" align="center" justify="space-between">
        <Title level={4}>工作台首页</Title>
        <Button type="primary" icon={<CheckSquareOutlined />}>进入任务中心</Button>
      </Flex>
      <StatRow />
      <Row gutter={16} className="workspace-columns">
        <Col xs={24} xl={16}><TodoCard compact={compact} /></Col>
        <Col xs={24} xl={8}>
          <Card size="small" title="今日动态" className="activity-card">
            <Timeline items={activities} />
          </Card>
          <Card size="small" title="当前任职上下文" className="context-card">
            <Flex vertical gap={10}>
              <Flex justify="space-between"><Text type="secondary">任职</Text><strong>平台测试组 · 工作台使用者</strong></Flex>
              <Flex justify="space-between"><Text type="secondary">状态</Text><Tag color="success">有效</Tag></Flex>
              <Flex justify="space-between"><Text type="secondary">上下文引用</Text><Text code>fixture-assignment-01</Text></Flex>
            </Flex>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return <div className="workspace-home"><Title level={4}>{title}</Title><Card className="placeholder"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该预览重点展示工作台首页样式" /></Card></div>;
}

function WorkbenchPreview() {
  const [primaryCollapsed, setPrimaryCollapsed] = useState(false);
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(false);
  const [primary, setPrimary] = useState<PrimaryKey>("workspace");
  const [secondary, setSecondary] = useState("overview");
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);

  const secondaryNav = useMemo(() => secondaryItems[primary], [primary]);
  const activePrimary = primaryItems.find((item) => item.key === primary) ?? primaryItems[0];
  const activeSecondary = secondaryNav.find((item) => item.key === secondary) ?? secondaryNav[0];

  const onPrimaryClick: MenuProps["onClick"] = ({ key }) => {
    const next = key as PrimaryKey;
    setPrimary(next);
    setSecondary(secondaryItems[next][0]?.key ?? "overview");
  };

  const userMenu: MenuProps = { items: [{ key: "identity", label: "合成使用者（平台测试组）", disabled: true }, { type: "divider" }, { key: "profile", label: "个人信息" }, { key: "logout", label: "退出登录" }] };

  return (
    <ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm, ...(compact ? [theme.compactAlgorithm] : [])], cssVar: true, token: { colorPrimary: "#1677ff", borderRadius: 10, fontSize: 14, colorBgLayout: dark ? "#050505" : "#f5f8ff" }, components: { Layout: { bodyBg: dark ? "#050505" : "#f5f8ff", headerBg: dark ? "#111111" : "#ffffff", siderBg: dark ? "#050505" : "#ffffff" }, Menu: { activeBarBorderWidth: 0, itemBg: "transparent", subMenuItemBg: "transparent" } } }}>
      <App>
        <Layout className="demo-shell">
          <Sider theme={dark ? "dark" : "light"} width={144} collapsedWidth={56} collapsed={primaryCollapsed} trigger={null} className="primary-sider">
            <Flex vertical className="sider-column">
              <div className="brand-title">{primaryCollapsed ? "CRM" : "中世健 AI-CRM"}</div>
              <Menu mode="inline" inlineCollapsed={primaryCollapsed} selectedKeys={[primary]} items={primaryItems} onClick={onPrimaryClick} />
              <div className="sider-trigger"><Tooltip title={primaryCollapsed ? "展开一级导航" : "收起一级导航"} placement="right"><Button type="text" block aria-label={primaryCollapsed ? "展开一级导航" : "收起一级导航"} icon={primaryCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setPrimaryCollapsed((value) => !value)} /></Tooltip></div>
            </Flex>
          </Sider>

          <Sider theme={dark ? "dark" : "light"} width={180} collapsedWidth={48} collapsed={secondaryCollapsed} trigger={null} className="secondary-sider">
            <Flex vertical className="sider-column">
              <div className="secondary-title">{!secondaryCollapsed && <Text strong ellipsis>{activePrimary?.label}</Text>}<Tooltip title={secondaryCollapsed ? "展开二级导航" : "收起二级导航"} placement="right"><Button type="text" size="small" aria-label={secondaryCollapsed ? "展开二级导航" : "收起二级导航"} icon={secondaryCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSecondaryCollapsed((value) => !value)} /></Tooltip></div>
              <Menu mode="inline" inlineCollapsed={secondaryCollapsed} selectedKeys={[secondary]} items={secondaryNav} onClick={({ key }) => setSecondary(key)} />
            </Flex>
          </Sider>

          <Layout className="right-layout">
            <Header className="demo-header">
              <Flex className="header-left" align="center" gap={16}>
                <Breadcrumb items={[{ title: activePrimary?.label }, { title: activeSecondary?.label }]} />
                <Select className="assignment-select" value="fixture-assignment-01" options={[{ label: "平台测试组 / 工作台使用者", value: "fixture-assignment-01" }]} />
              </Flex>
              <Flex className="header-actions" align="center" gap={10}>
                <Input className="header-search" prefix={<SearchOutlined />} placeholder="搜索功能 / 页面" />
                <Button type="text" icon={<ClockCircleOutlined />}>07-29 13:40</Button>
                <Popover placement="bottomRight" trigger="click" title="主题设置" content={<ThemePanel dark={dark} compact={compact} onDarkChange={setDark} onCompactChange={setCompact} />}><Button type="text" aria-label="主题设置" icon={<BgColorsOutlined />} /></Popover>
                <Tooltip title="通知中心"><Badge count={5} size="small"><Button type="text" aria-label="通知中心" icon={<BellOutlined />} /></Badge></Tooltip>
                <Dropdown menu={userMenu} placement="bottomRight"><Avatar className="user-avatar">合</Avatar></Dropdown>
              </Flex>
            </Header>
            <Content className="demo-content">{secondary === "overview" ? <WorkspaceHome compact={compact} /> : <Placeholder title={activeSecondary?.label ?? "平台页面"} />}</Content>
          </Layout>
        </Layout>
      </App>
    </ConfigProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Preview root was not found.");
ReactDOM.createRoot(root).render(<React.StrictMode><WorkbenchPreview /></React.StrictMode>);
