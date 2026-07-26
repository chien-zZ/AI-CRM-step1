import { createHash } from "node:crypto";
import { AppRegistryError } from "./errors.js";
import type { DeepLinkSource, RegisteredApplication, RegisteredDeepLink, RegisteredNavigation, RegisteredRoute, RegistryActor, RegistryAudience, RegistryMutationCommand } from "./types.js";

const ID = /^[a-z][a-z0-9_.-]{0,127}$/u;
const PERMISSION = /^[a-z][a-z0-9_.-]{0,63}:[a-z][a-z0-9_.-]{0,63}$/u;
const PATH = /^\/[a-z0-9_./:-]{0,255}$/u;
const REFERENCE = /^[A-Za-z0-9_.:-]{1,255}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACE = /^(?!0{32})[0-9a-f]{32}$/u;
const invalid = (): never => { throw new AppRegistryError("app_registry_invalid_input"); };
const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const exact = (value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  const candidate = object(value);
  const keys = Object.keys(candidate);
  if (required.some((key) => !Object.hasOwn(candidate, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return candidate;
};
const array = (value: unknown, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value as unknown[];
};
const string = (value: unknown, pattern: RegExp): string => typeof value === "string" && pattern.test(value) ? value : invalid();
const boolean = (value: unknown): boolean => typeof value === "boolean" ? value : invalid();
const audience = (value: unknown): RegistryAudience => value === "internal" || value === "external" ? value : invalid();
const source = (value: unknown): DeepLinkSource => value === "notification" || value === "task" ? value : invalid();

export function validateActor(value: unknown): RegistryActor {
  const actor = exact(value, ["actorId", "actorType"], ["assignmentId", "workforcePersonId"]);
  const actorType = actor.actorType === "authenticated_subject" || actor.actorType === "system" ? actor.actorType : invalid();
  return {
    actorId: string(actor.actorId, REFERENCE),
    actorType,
    ...(actor.assignmentId === undefined ? {} : { assignmentId: string(actor.assignmentId, UUID).toLowerCase() }),
    ...(actor.workforcePersonId === undefined ? {} : { workforcePersonId: string(actor.workforcePersonId, UUID).toLowerCase() }),
  };
}

export function validateApplication(value: unknown): RegisteredApplication {
  const application = exact(value, ["applicationId", "audience", "enabled", "permissionCode"]);
  return { applicationId: string(application.applicationId, ID), audience: audience(application.audience), enabled: boolean(application.enabled), permissionCode: string(application.permissionCode, PERMISSION) };
}

export function validateRoute(value: unknown): RegisteredRoute {
  const route = exact(value, ["applicationId", "deepLinkSources", "enabled", "path", "permissionCode", "routeId"]);
  const sourceValues = array(route.deepLinkSources, 2);
  const deepLinkSources = sourceValues.map(source);
  const path = string(route.path, PATH);
  if (path.includes("//") || path.includes("..") || path.includes("?") || path.includes("#") || new Set(deepLinkSources).size !== deepLinkSources.length) invalid();
  return { applicationId: string(route.applicationId, ID), deepLinkSources, enabled: boolean(route.enabled), path, permissionCode: string(route.permissionCode, PERMISSION), routeId: string(route.routeId, ID) };
}

export function validateNavigation(value: unknown): RegisteredNavigation {
  const navigation = exact(value, ["applicationId", "enabled", "navigationId", "order", "routeId"], ["parentNavigationId"]);
  const navigationId = string(navigation.navigationId, ID);
  const parentNavigationId = navigation.parentNavigationId === undefined ? undefined : string(navigation.parentNavigationId, ID);
  if (!Number.isInteger(navigation.order) || (navigation.order as number) < 0 || (navigation.order as number) > 100_000 || parentNavigationId === navigationId) invalid();
  return { applicationId: string(navigation.applicationId, ID), enabled: boolean(navigation.enabled), navigationId, order: navigation.order as number, ...(parentNavigationId === undefined ? {} : { parentNavigationId }), routeId: string(navigation.routeId, ID) };
}

export function validateMutation(value: unknown): RegistryMutationCommand {
  const base = object(value);
  const kind = base.kind;
  const commonRequired = ["actor", "kind", "operationId", "reason", "traceId"];
  const common = (specific: readonly string[]): Record<string, unknown> => exact(value, [...commonRequired, ...specific]);
  const command = kind === "register_application" ? common(["application"])
    : kind === "register_route" ? common(["route"])
      : kind === "register_navigation" ? common(["navigation"])
        : kind === "set_application_enabled" ? common(["applicationId", "enabled"])
          : kind === "set_route_enabled" ? common(["enabled", "routeId"])
            : invalid();
  const actor = validateActor(command.actor);
  const operationId = string(command.operationId, UUID).toLowerCase();
  const traceId = string(command.traceId, TRACE).toLowerCase();
  const reason = typeof command.reason === "string" && command.reason.length >= 1 && command.reason.length <= 500 ? command.reason : invalid();
  const metadata = { actor, operationId, reason, traceId };
  if (kind === "register_application") return { ...metadata, application: validateApplication(command.application), kind };
  if (kind === "register_route") return { ...metadata, kind, route: validateRoute(command.route) };
  if (kind === "register_navigation") return { ...metadata, kind, navigation: validateNavigation(command.navigation) };
  if (kind === "set_application_enabled") return { ...metadata, applicationId: string(command.applicationId, ID), enabled: boolean(command.enabled), kind };
  return { ...metadata, enabled: boolean(command.enabled), kind: "set_route_enabled", routeId: string(command.routeId, ID) };
}

export function validateDeepLink(value: unknown): RegisteredDeepLink {
  const link = exact(value, ["applicationId", "resourceReference", "routeId", "source", "version"]);
  if (link.version !== 1) invalid();
  return { applicationId: string(link.applicationId, ID), resourceReference: string(link.resourceReference, REFERENCE), routeId: string(link.routeId, ID), source: source(link.source), version: 1 };
}

export function validateLoadInput(value: unknown): { readonly actor: RegistryActor; readonly audience: RegistryAudience } {
  const input = exact(value, ["actor", "audience"]);
  return { actor: validateActor(input.actor), audience: audience(input.audience) };
}

export function validateResolveInput(value: unknown): { readonly actor: RegistryActor; readonly audience: RegistryAudience; readonly link: RegisteredDeepLink } {
  const input = exact(value, ["actor", "audience", "link"]);
  return { actor: validateActor(input.actor), audience: audience(input.audience), link: validateDeepLink(input.link) };
}

export function validateAuthorizationDecision(value: unknown): { readonly allowed: boolean; readonly decisionId: string } {
  const decision = exact(value, ["allowed", "decisionId"]);
  return { allowed: boolean(decision.allowed), decisionId: string(decision.decisionId, UUID).toLowerCase() };
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export const mutationFingerprint = (command: RegistryMutationCommand): string => {
  const semantic = { ...command, traceId: undefined } as Record<string, unknown>;
  if (command.kind === "register_route") semantic.route = { ...command.route, deepLinkSources: [...command.route.deepLinkSources].sort() };
  return createHash("sha256").update(canonical(semantic)).digest("hex");
};
