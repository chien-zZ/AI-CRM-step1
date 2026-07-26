import { createHash } from "node:crypto";
import { AppRegistryError } from "./errors.js";
import type { RegisteredApplication, RegisteredDeepLink, RegisteredNavigation, RegisteredRoute, RegistryActor, RegistryMutationCommand } from "./types.js";

const ID = /^[a-z][a-z0-9_.-]{0,127}$/u;
const PERMISSION = /^[a-z][a-z0-9_.-]{0,63}:[a-z][a-z0-9_.-]{0,63}$/u;
const PATH = /^\/[a-z0-9_./:-]{0,255}$/u;
const REFERENCE = /^[A-Za-z0-9_.:-]{1,255}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACE = /^(?!0{32})[0-9a-f]{32}$/u;
const invalid = (): never => { throw new AppRegistryError("app_registry_invalid_input"); };

export function validateActor(actor: RegistryActor): void {
  if (!REFERENCE.test(actor.actorId) || (actor.assignmentId !== undefined && !UUID.test(actor.assignmentId)) || (actor.workforcePersonId !== undefined && !UUID.test(actor.workforcePersonId))) invalid();
}
export function validateApplication(value: RegisteredApplication): void { if (!ID.test(value.applicationId) || !PERMISSION.test(value.permissionCode)) invalid(); }
export function validateRoute(value: RegisteredRoute): void {
  if (!ID.test(value.applicationId) || !ID.test(value.routeId) || !PATH.test(value.path) || value.path.includes("//") || value.path.includes("..") || value.path.includes("?") || value.path.includes("#") || !PERMISSION.test(value.permissionCode) || new Set(value.deepLinkSources).size !== value.deepLinkSources.length) invalid();
}
export function validateNavigation(value: RegisteredNavigation): void {
  if (!ID.test(value.applicationId) || !ID.test(value.navigationId) || !ID.test(value.routeId) || (value.parentNavigationId !== undefined && !ID.test(value.parentNavigationId)) || !Number.isInteger(value.order) || value.order < 0 || value.order > 100_000) invalid();
}
export function validateMutation(command: RegistryMutationCommand): void {
  validateActor(command.actor);
  if (!UUID.test(command.operationId) || !TRACE.test(command.traceId) || command.reason.length < 1 || command.reason.length > 500) invalid();
  if (command.kind === "register_application") validateApplication(command.application);
  if (command.kind === "register_route") validateRoute(command.route);
  if (command.kind === "register_navigation") validateNavigation(command.navigation);
  if (command.kind === "set_application_enabled" && !ID.test(command.applicationId)) invalid();
  if (command.kind === "set_route_enabled" && !ID.test(command.routeId)) invalid();
}
export function validateDeepLink(link: RegisteredDeepLink): void {
  if (!ID.test(link.applicationId) || !ID.test(link.routeId) || !REFERENCE.test(link.resourceReference)) invalid();
}
export const mutationFingerprint = (command: RegistryMutationCommand): string => createHash("sha256").update(JSON.stringify({ ...command, traceId: undefined })).digest("hex");
