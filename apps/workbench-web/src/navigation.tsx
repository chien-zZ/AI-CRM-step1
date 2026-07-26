import {
  AuditOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  DesktopOutlined,
  ExportOutlined,
  FileOutlined,
  FundProjectionScreenOutlined,
  GlobalOutlined,
  InboxOutlined,
  MailOutlined,
  ScheduleOutlined,
  SendOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from "@ant-design/icons";
import React, { type ReactNode } from "react";

export interface SecondaryNavItem {
  key: string;
  label: string;
  icon: ReactNode;
}

export interface PrimaryNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  children: SecondaryNavItem[];
}

export const navigation: PrimaryNavItem[] = [
  {
    key: "workbench",
    label: "工作台",
    icon: <DesktopOutlined />,
    children: [
      { key: "/", label: "经营首页", icon: <FundProjectionScreenOutlined /> },
      { key: "/students", label: "学员与分配", icon: <TeamOutlined /> },
      { key: "/approvals", label: "审批中心", icon: <AuditOutlined /> },
      { key: "/risks", label: "异常与风险", icon: <ThunderboltOutlined /> },
    ],
  },
  {
    key: "calendar",
    label: "日历",
    icon: <CalendarOutlined />,
    children: [
      { key: "/calendar", label: "我的日程", icon: <ScheduleOutlined /> },
      { key: "/calendar/interviews", label: "采访排期", icon: <ClockCircleOutlined /> },
    ],
  },
  {
    key: "approvals",
    label: "审批",
    icon: <AuditOutlined />,
    children: [
      { key: "/workflow/mine", label: "我发起的", icon: <ExportOutlined /> },
      { key: "/workflow/todo", label: "待我审批", icon: <CheckSquareOutlined /> },
      { key: "/workflow/all", label: "全部审批", icon: <UnorderedListOutlined /> },
    ],
  },
  {
    key: "notifications",
    label: "通知",
    icon: <BellOutlined />,
    children: [
      { key: "/notifications", label: "全部通知", icon: <BellOutlined /> },
      { key: "/notifications/todo", label: "待办提醒", icon: <ClockCircleOutlined /> },
      { key: "/notifications/system", label: "系统 / 外部", icon: <GlobalOutlined /> },
    ],
  },
  {
    key: "mail",
    label: "邮件",
    icon: <MailOutlined />,
    children: [
      { key: "/mail/inbox", label: "收件箱", icon: <InboxOutlined /> },
      { key: "/mail/sent", label: "已发送", icon: <SendOutlined /> },
      { key: "/mail/drafts", label: "草稿箱", icon: <FileOutlined /> },
    ],
  },
  {
    key: "settings",
    label: "设置",
    icon: <SettingOutlined />,
    children: [
      { key: "/settings/system", label: "系统设置", icon: <SettingOutlined /> },
      { key: "/settings/profile", label: "个人信息", icon: <UserOutlined /> },
    ],
  },
];

export function matchNavigation(pathname: string): {
  primary: PrimaryNavItem;
  secondary: SecondaryNavItem;
} {
  let bestMatch: { primary: PrimaryNavItem; secondary: SecondaryNavItem } | undefined;

  for (const primary of navigation) {
    for (const secondary of primary.children) {
      const matches = secondary.key === "/"
        ? pathname === "/"
        : pathname === secondary.key || pathname.startsWith(`${secondary.key}/`);
      if (matches && (!bestMatch || secondary.key.length > bestMatch.secondary.key.length)) {
        bestMatch = { primary, secondary };
      }
    }
  }

  const fallbackPrimary = navigation[0];
  const fallbackSecondary = fallbackPrimary?.children[0];
  if (!fallbackPrimary || !fallbackSecondary) {
    throw new Error("Workbench navigation must contain at least one route.");
  }
  return bestMatch ?? { primary: fallbackPrimary, secondary: fallbackSecondary };
}
