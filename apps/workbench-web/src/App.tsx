import {
  BellOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DownOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Col,
  ConfigProvider,
  Dropdown,
  Flex,
  Input,
  Layout,
  Menu,
  Row,
  Select,
  Statistic,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { matchNavigation, navigation } from "./navigation";
import "./styles.css";

const { Header, Content, Sider } = Layout;
const { Text, Title } = Typography;

const todoGroups = [
  {
    title: "待审批",
    items: [
      { name: "林晓雨", description: "内容方案等待负责人确认", tag: "内容审核", due: "剩余 1 小时", color: "#7265e6" },
      { name: "周亦辰", description: "阶段复盘材料已补充", tag: "复盘确认", due: "今天 17:30", color: "#1677ff" },
    ],
  },
  {
    title: "需跟进",
    items: [
      { name: "陈言", description: "计划节点临近，请检查当前进度", tag: "进度跟进", due: "已超时 35 分", color: "#f56a00", danger: true },
      { name: "苏晴", description: "等待补充本周执行反馈", tag: "材料补充", due: "明天 10:00", color: "#13c2c2" },
    ],
  },
];

const statistics = [
  { label: "在跑学员", value: 128 },
  { label: "待处理任务", value: 16 },
  { label: "临近到期", value: 5, color: "#fa8c16" },
  { label: "已超时", value: 2, color: "#ff4d4f" },
  { label: "暂停计时", value: 3 },
];

function WorkspacePage(): React.JSX.Element {
  return (
    <div className="workspace-page">
      <Flex align="center" justify="space-between" gap={16} className="page-heading">
        <div>
          <Title level={4}>经营首页</Title>
          <Text type="secondary">工作台 Demo 样式的 Vite 重构预览</Text>
        </div>
        <Button type="primary">查看全部待办</Button>
      </Flex>

      <Row gutter={12} className="stat-row">
        {statistics.map((item) => (
          <Col flex="1" key={item.label}>
            <Card size="small" className="stat-card">
              <Statistic
                title={item.label}
                value={item.value}
                {...(item.color ? { styles: { content: { color: item.color } } } : {})}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={16} className="main-grid">
        <Col xs={24} xl={16}>
          <Card
            size="small"
            title="今日待办（4）"
            extra={<Select size="small" defaultValue="action" options={[{ label: "按动作", value: "action" }, { label: "按 SLA", value: "sla" }]} />}
            className="content-card"
          >
            {todoGroups.map((group) => (
              <div key={group.title}>
                <Flex align="center" gap={8} className="todo-group-title">
                  <Text strong>{group.title}</Text>
                  <Badge count={group.items.length} color="#1677ff" />
                </Flex>
                {group.items.map((item) => (
                  <Flex align="center" gap={12} className="todo-row" key={item.name}>
                    <Avatar style={{ backgroundColor: item.color }}>{item.name.slice(0, 1)}</Avatar>
                    <div className="todo-copy">
                      <Flex align="center" gap={8} wrap="wrap">
                        <Text strong>{item.name}</Text>
                        <Tag color="blue">{item.tag}</Tag>
                        <Text type="secondary">{item.description}</Text>
                      </Flex>
                    </div>
                    <Text className={item.danger ? "due danger" : "due"}>
                      <ClockCircleOutlined /> {item.due}
                    </Text>
                    <RightOutlined className="row-arrow" />
                  </Flex>
                ))}
              </div>
            ))}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card size="small" title="今日动态" className="content-card activity-card">
            <Timeline
              items={[
                { color: "green", content: <><Text strong>内容方案已通过</Text><br /><Text type="secondary">10:32 · 负责人</Text></> },
                { color: "blue", content: <><Text strong>新增阶段跟进记录</Text><br /><Text type="secondary">09:48 · 陪跑运营</Text></> },
                { color: "orange", content: <><Text strong>任务即将到期</Text><br /><Text type="secondary">09:10 · 系统</Text></> },
                { color: "gray", content: <><Text strong>工作台数据已同步</Text><br /><Text type="secondary">08:30 · 系统</Text></> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="workspace-page">
      <Title level={4}>{title}</Title>
      <Card className="placeholder-card">
        <Flex vertical align="center" justify="center" gap={12}>
          <CalendarOutlined className="placeholder-icon" />
          <Text type="secondary">该页面暂时只用于验证 Demo 导航、布局与视觉框架。</Text>
        </Flex>
      </Card>
    </div>
  );
}

function WorkbenchShell(): React.JSX.Element {
  const { token } = theme.useToken();
  const location = useLocation();
  const navigate = useNavigate();
  const [primaryCollapsed, setPrimaryCollapsed] = useState(false);
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(false);
  const active = useMemo(() => matchNavigation(location.pathname), [location.pathname]);

  const primaryItems = navigation.map((item) => ({ key: item.key, icon: item.icon, label: item.label }));
  const secondaryItems = active.primary.children.map((item) => ({ key: item.key, icon: item.icon, label: item.label }));

  const selectPrimary = (key: string): void => {
    const target = navigation.find((item) => item.key === key)?.children[0];
    if (target) void navigate(target.key);
  };

  return (
    <Layout className="app-shell">
      <Sider
        theme="light"
        width={144}
        collapsedWidth={56}
        collapsed={primaryCollapsed}
        trigger={null}
        className="primary-sider"
      >
        <Flex vertical className="sider-column">
          <Flex align="center" justify="center" className={primaryCollapsed ? "brand brand-collapsed" : "brand"}>
            {primaryCollapsed ? "CRM" : "中世健 AI-CRM"}
          </Flex>
          <div className="menu-scroll">
            <Menu
              mode="inline"
              inlineCollapsed={primaryCollapsed}
              selectedKeys={[active.primary.key]}
              items={primaryItems}
              onClick={({ key }) => {
                selectPrimary(key);
              }}
              className="shell-menu"
            />
          </div>
          <div className="collapse-footer">
            <Button
              type="text"
              block
              aria-label={primaryCollapsed ? "展开一级导航" : "收起一级导航"}
              icon={primaryCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => {
                setPrimaryCollapsed((value) => !value);
              }}
            />
          </div>
        </Flex>
      </Sider>

      <Sider
        theme="light"
        width={180}
        collapsedWidth={48}
        collapsed={secondaryCollapsed}
        trigger={null}
        className="secondary-sider"
      >
        <Flex vertical className="sider-column">
          <Flex align="center" justify={secondaryCollapsed ? "center" : "space-between"} className="secondary-heading">
            {!secondaryCollapsed && <Text strong ellipsis>{active.primary.label}</Text>}
            <Tooltip title={secondaryCollapsed ? "展开二级导航" : "收起二级导航"} placement="right">
              <Button
                type="text"
                size="small"
                aria-label={secondaryCollapsed ? "展开二级导航" : "收起二级导航"}
                icon={secondaryCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => {
                  setSecondaryCollapsed((value) => !value);
                }}
              />
            </Tooltip>
          </Flex>
          <div className="menu-scroll">
            <Menu
              mode="inline"
              inlineCollapsed={secondaryCollapsed}
              selectedKeys={[active.secondary.key]}
              items={secondaryItems}
              onClick={({ key }) => {
                void navigate(key);
              }}
              className="shell-menu"
            />
          </div>
        </Flex>
      </Sider>

      <Layout className="right-layout">
        <Header className="topbar" style={{ borderBottomColor: token.colorBorderSecondary }}>
          <Flex align="center" gap={16} className="topbar-left">
            <Breadcrumb items={[{ title: active.primary.label }, { title: active.secondary.label }]} />
            <Dropdown menu={{ items: [{ key: "director", label: "三部负责人" }, { key: "operator", label: "陪跑运营" }] }}>
              <Button size="small">三部负责人 <DownOutlined /></Button>
            </Dropdown>
          </Flex>
          <Flex align="center" gap={10} className="topbar-actions">
            <Input prefix={<SearchOutlined />} placeholder="搜索学员 / 审批 / 风险" className="global-search" />
            <Button type="text" icon={<ClockCircleOutlined />}>07-26 14:30</Button>
            <Tooltip title="通知中心">
              <Badge count={5} size="small"><Button type="text" icon={<BellOutlined />} aria-label="通知中心" /></Badge>
            </Tooltip>
            <Dropdown menu={{ items: [{ key: "profile", label: "个人信息" }, { key: "settings", label: "系统设置" }] }}>
              <Avatar className="profile-avatar">管</Avatar>
            </Dropdown>
          </Flex>
        </Header>
        <Content className="content-area">
          {location.pathname === "/" ? <WorkspacePage /> : <PlaceholderPage title={active.secondary.label} />}
        </Content>
      </Layout>
    </Layout>
  );
}

export function App(): React.JSX.Element {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 6,
          fontSize: 14,
          colorBgLayout: "#f5f7fa",
        },
        components: {
          Layout: { headerBg: "#ffffff", siderBg: "#ffffff" },
          Menu: { itemHeight: 40, itemMarginInline: 6, itemBorderRadius: 5 },
        },
      }}
    >
      <WorkbenchShell />
    </ConfigProvider>
  );
}
