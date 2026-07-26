import { createTaroH5Adapters } from "../../adapters";
import { normalizeStatus, sectionPath } from "../../route-state";
import { StatusView } from "../../status-view";

export default function StatusPage(): React.JSX.Element {
  const adapters = createTaroH5Adapters();
  const kind = normalizeStatus(adapters.navigation.currentParameters()["kind"]);
  return <StatusView kind={kind} onHome={() => { void adapters.navigation.replace(sectionPath("home")); }} onLogin={() => { adapters.session.login(); }} onRetry={() => { void adapters.navigation.replace(sectionPath("home")); }} />;
}
