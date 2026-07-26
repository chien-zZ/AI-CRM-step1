import {
  Button as NutButton,
  CellGroup as NutCellGroup,
  Empty as NutEmpty,
  NavBar as NutNavBar,
  NoticeBar as NutNoticeBar,
  Tag as NutTag,
} from "@nutui/nutui-react-taro";
import type { JSX, PropsWithChildren, ReactNode } from "react";

type React18Component<Props> = (props: Props) => JSX.Element;

type ButtonProps = PropsWithChildren<{
  disabled?: boolean;
  fill?: "none" | "outline" | "solid";
  onClick?: () => void;
  size?: "small";
  type?: "primary";
}>;

type CellGroupProps = PropsWithChildren;

type EmptyProps = {
  description?: ReactNode;
  title?: ReactNode;
};

type NavBarProps = {
  fixed?: boolean;
  safeAreaInsetTop?: boolean;
  title: ReactNode;
};

type NoticeBarProps = {
  content: string;
};

type TagProps = PropsWithChildren<{
  type?: "default" | "primary";
}>;

// NutUI supports React 18 at runtime, but its declarations can resolve through
// a transitive React 19 type copy in pnpm's virtual store. Keep that mismatch
// behind this application-owned boundary and expose only the props used here.
export const Button = NutButton as unknown as React18Component<ButtonProps>;
export const CellGroup = NutCellGroup as unknown as React18Component<CellGroupProps>;
export const Empty = NutEmpty as unknown as React18Component<EmptyProps>;
export const NavBar = NutNavBar as unknown as React18Component<NavBarProps>;
export const NoticeBar = NutNoticeBar as unknown as React18Component<NoticeBarProps>;
export const Tag = NutTag as unknown as React18Component<TagProps>;
