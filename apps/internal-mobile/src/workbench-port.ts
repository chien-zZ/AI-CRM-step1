export type MobileSection = "forms" | "home" | "notifications" | "tasks";
export type MobileStatus = "forbidden" | "maintenance" | "offline" | "session-expired" | "unavailable";

export interface MobileItem {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly status: string;
}

export interface ReadyMobileBootstrap {
  readonly kind: "ready";
  readonly fixture: boolean;
  readonly contextLabel: string;
  readonly collections: Readonly<Record<Exclude<MobileSection, "home">, readonly MobileItem[]>>;
}

export type MobileBootstrapResult = ReadyMobileBootstrap | { readonly kind: MobileStatus };
export type MobileLogoutResult = { readonly kind: "session-expired" | "signed-out" };

export interface InternalMobilePort {
  bootstrap(): Promise<MobileBootstrapResult>;
  logout(): Promise<MobileLogoutResult>;
}
