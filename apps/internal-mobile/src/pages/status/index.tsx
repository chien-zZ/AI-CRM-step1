import { View } from "@tarojs/components";
import { useState } from "react";
import { createTaroH5Adapters } from "../../adapters";
import { NoticeBar } from "../../nutui-adapter";
import type { ReturnTypeOfAdapters } from "../../types-internal";
import { normalizeStatus, sectionPath } from "../../route-state";
import { StatusView } from "../../status-view";
import type { MobileStatus } from "../../workbench-port";

export function StatusPageContent({ adapters, kind }: { adapters: ReturnTypeOfAdapters; kind: MobileStatus }): React.JSX.Element {
  const [loginPending, setLoginPending] = useState(false);
  return (
    <View>
      {loginPending && <NoticeBar content="内部移动登录契约尚未接入，当前保持失败关闭。" />}
      <StatusView kind={kind} onHome={() => { void adapters.navigation.replace(sectionPath("home")); }} onLogin={() => { adapters.session.login(); setLoginPending(true); }} onRetry={() => { void adapters.navigation.replace(sectionPath("home")); }} />
    </View>
  );
}

export default function StatusPage(): React.JSX.Element {
  const adapters = createTaroH5Adapters();
  const kind = normalizeStatus(adapters.navigation.currentParameters()["kind"]);
  return <StatusPageContent adapters={adapters} kind={kind} />;
}
