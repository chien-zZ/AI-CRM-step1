import { BellOutlined, CheckCircleOutlined, ClockCircleOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { PageContainer } from "@ant-design/pro-components";
import { Alert, Card, Descriptions, Typography } from "antd";
import type { BootstrapResult } from "./workbench-port";

const { Text } = Typography;

export function Overview({ data }: { data: Extract<BootstrapResult, { kind: "ready" }> }): React.JSX.Element {
  return (
    <PageContainer title="工作概览" subTitle="需要关注的平台协同事项">
      {data.fixture && <Alert className="fixture-alert" type="info" showIcon title="开发 Fixture" description="计数来自合成开发数据，不是业务指标或生产事实。" />}
      <div className="overview-stats">
        <Card size="small"><StatisticCard title="待查看任务" value={data.counts.tasks} icon={<ClockCircleOutlined />} /></Card>
        <Card size="small"><StatisticCard title="未读通知" value={data.counts.notifications} icon={<BellOutlined />} /></Card>
        <Card size="small"><StatisticCard title="可用表单" value={data.counts.forms} icon={<CheckCircleOutlined />} /></Card>
        <Card size="small"><StatisticCard title="可用文件引用" value={data.counts.files} icon={<SafetyCertificateOutlined />} /></Card>
      </div>
      <Card title="当前任职上下文" size="small" className="context-card">
        <Descriptions column={{ xs: 1, sm: 2 }} size="small" className="stable-descriptions">
          <Descriptions.Item label="显示名称"><span className="break-text">{data.context.displayName}</span></Descriptions.Item>
          <Descriptions.Item label="上下文引用"><span className="break-text">{data.context.assignmentReference}</span></Descriptions.Item>
        </Descriptions>
      </Card>
    </PageContainer>
  );
}

function StatisticCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }): React.JSX.Element {
  return <div className="statistic-card"><span className="statistic-icon" aria-hidden="true">{icon}</span><span><Text type="secondary">{title}</Text><strong>{value}</strong></span></div>;
}
