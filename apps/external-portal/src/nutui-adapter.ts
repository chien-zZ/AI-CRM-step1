import { Button as NutButton, Empty as NutEmpty, NavBar as NutNavBar, NoticeBar as NutNoticeBar, Tag as NutTag } from "@nutui/nutui-react-taro";
import type { JSX, PropsWithChildren, ReactNode } from "react";

type React18Component<Props> = (props: Props) => JSX.Element;
type ButtonProps = PropsWithChildren<{ disabled?: boolean; fill?: "none" | "outline" | "solid"; onClick?: () => void; size?: "small"; type?: "primary" }>;
type EmptyProps = { description?: ReactNode; title?: ReactNode };
type NavBarProps = { fixed?: boolean; safeAreaInsetTop?: boolean; title: ReactNode };
type NoticeBarProps = { content: string };
type TagProps = PropsWithChildren<{ type?: "default" | "primary" }>;

export const Button = NutButton as unknown as React18Component<ButtonProps>;
export const Empty = NutEmpty as unknown as React18Component<EmptyProps>;
export const NavBar = NutNavBar as unknown as React18Component<NavBarProps>;
export const NoticeBar = NutNoticeBar as unknown as React18Component<NoticeBarProps>;
export const Tag = NutTag as unknown as React18Component<TagProps>;
