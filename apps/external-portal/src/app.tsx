import "@nutui/nutui-react-taro/dist/style.css";
import type { PropsWithChildren } from "react";
import "./app.scss";

export default function App({ children }: PropsWithChildren): React.JSX.Element {
  return <>{children}</>;
}
