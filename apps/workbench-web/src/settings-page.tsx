import { PageContainer } from "@ant-design/pro-components";
import { Card, Empty } from "antd";

export function SettingsPage(): React.JSX.Element {
  return <PageContainer title="个人设置"><Card size="small"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前阶段没有可编辑的个人设置" /></Card></PageContainer>;
}
