import { createTaroH5Adapters } from "./adapters";
import { MobileShell } from "./mobile-shell";
import { runtimeInternalMobilePort } from "@internal-mobile/runtime-port";
import type { MobileSection } from "./workbench-port";

export function InternalMobilePage({ section }: { section: MobileSection }): React.JSX.Element {
  const adapters = createTaroH5Adapters();
  return <MobileShell adapters={adapters} port={runtimeInternalMobilePort} section={section} />;
}
