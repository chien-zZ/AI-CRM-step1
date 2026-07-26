import { SystemState } from "./system-state";
import type { StateKind } from "./system-state";

export function StatusRoutePage({ kind, loginUrl }: { kind: StateKind; loginUrl?: string }): React.JSX.Element {
  return <SystemState kind={kind} {...(loginUrl === undefined ? {} : { loginUrl })} />;
}
