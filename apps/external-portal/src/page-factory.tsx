import { externalPortalPort } from "@external-portal/runtime-port";
import { createTaroPortalAdapters } from "./adapters";
import { PortalShell } from "./portal-shell";

export function ExternalPortalPage(): React.JSX.Element {
  return <PortalShell adapters={createTaroPortalAdapters()} port={externalPortalPort} />;
}
