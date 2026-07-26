import {
  AppstoreOutlined,
  BellOutlined,
  CheckSquareOutlined,
  FileOutlined,
  FormOutlined,
  HomeOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

export interface NavigationItem {
  key: string;
  label: string;
  icon: ReactNode;
  children?: NavigationItem[];
}

export const navigation: NavigationItem[] = [
  { key: "/workspace", label: "工作概览", icon: <HomeOutlined /> },
  {
    key: "/coordination",
    label: "协同",
    icon: <AppstoreOutlined />,
    children: [
      { key: "/tasks", label: "统一任务", icon: <CheckSquareOutlined /> },
      { key: "/notifications", label: "站内通知", icon: <BellOutlined /> },
    ],
  },
  {
    key: "/resources",
    label: "平台资源",
    icon: <AppstoreOutlined />,
    children: [
      { key: "/forms", label: "表单", icon: <FormOutlined /> },
      { key: "/files", label: "文件", icon: <FileOutlined /> },
    ],
  },
  { key: "/settings", label: "个人设置", icon: <SettingOutlined /> },
];

export function flattenNavigation(items: NavigationItem[] = navigation): NavigationItem[] {
  return items.flatMap((item) => [item, ...flattenNavigation(item.children ?? [])]);
}

export function matchNavigation(pathname: string): NavigationItem | undefined {
  return flattenNavigation()
    .filter((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
    .sort((left, right) => right.key.length - left.key.length)[0];
}

export function getNavigationSelection(pathname: string): { openKeys: string[]; selectedKey?: string } {
  const matched = matchNavigation(pathname);
  if (matched === undefined) return { openKeys: [] };
  const parent = navigation.find((item) => item.children?.some((child) => child.key === matched.key));
  return {
    openKeys: parent === undefined ? [] : [parent.key],
    selectedKey: matched.key,
  };
}
