import type { PortalStatus } from "./portal-port";

export type PortalView = "boundary" | "overview";

const statuses: readonly PortalStatus[] = ["contract-pending", "denied", "empty", "offline", "session-expired", "unavailable"];

export function normalizePortalView(value: string | undefined): PortalView {
  return value === "boundary" ? "boundary" : "overview";
}

export function normalizePortalStatus(value: string | undefined): PortalStatus {
  return statuses.find((status) => status === value) ?? "unavailable";
}

export function homePath(view: PortalView): string {
  return `/pages/home/index?view=${encodeURIComponent(view)}`;
}

export function statusPath(status: PortalStatus): string {
  return `/pages/status/index?kind=${encodeURIComponent(status)}`;
}
