import { View } from "@tarojs/components";
import { createTaroPortalAdapters } from "../../adapters";
import { normalizePortalStatus } from "../../route-state";
import { StatusView } from "../../status-view";

export default function StatusPage(): React.JSX.Element {
  const adapters = createTaroPortalAdapters();
  const kind = normalizePortalStatus(adapters.navigation.currentParameters()["kind"]);
  return <View><StatusView kind={kind} onHome={() => { void adapters.navigation.home("overview"); }} onRetry={() => { void adapters.navigation.home("overview"); }} /></View>;
}
