import type { MobileSection, MobileStatus } from "./workbench-port";

const sections: readonly MobileSection[] = ["home", "tasks", "notifications", "forms"];
const statuses: readonly MobileStatus[] = ["forbidden", "maintenance", "offline", "session-expired", "unavailable"];

export interface MobileRouteState {
  readonly page: number;
  readonly selected?: string;
}

export function normalizeRouteState(parameters: Readonly<Record<string, string>>, itemIds: readonly string[]): MobileRouteState {
  const requestedPage = Number(parameters["page"] ?? "1");
  const maximumPage = Math.max(1, Math.ceil(itemIds.length / 3));
  const page = Number.isSafeInteger(requestedPage) ? Math.min(Math.max(requestedPage, 1), maximumPage) : 1;
  const selected = parameters["selected"];
  return { page, ...(selected !== undefined && itemIds.includes(selected) ? { selected } : {}) };
}

export function sectionPath(section: MobileSection, state: MobileRouteState = { page: 1 }): string {
  const base = section === "home" ? "/pages/home/index" : `/pages/${section}/index`;
  if (section === "home") return base;
  const query = new URLSearchParams({ page: String(state.page), ...(state.selected === undefined ? {} : { selected: state.selected }) });
  return `${base}?${query.toString()}`;
}

export function normalizeSection(value: string | undefined): MobileSection {
  return sections.includes(value as MobileSection) ? value as MobileSection : "home";
}

export function normalizeStatus(value: string | undefined): MobileStatus {
  return statuses.includes(value as MobileStatus) ? value as MobileStatus : "unavailable";
}
