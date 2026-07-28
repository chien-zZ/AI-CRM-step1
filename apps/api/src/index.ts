import { createHash } from "node:crypto";
import "reflect-metadata";
import { Controller, Get, Inject, Injectable, Module, Post, Req, Res, type OnApplicationShutdown } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { DynamicModule, INestApplication } from "@nestjs/common";
import type { Request, Response } from "express";
import { evaluateHealth, extractTraceContext, type ApplicationLogger, type HealthDependency, type HealthResult } from "@ai-crm/observability";
import type { PermissionRequest } from "@ai-crm/platform-authorization";
import { BrowserSessionFailure } from "./auth/errors.js";
import { parsePcSessionCredential, type AuthenticationHttpResponse, type BrowserRequestContext, type PcAuthenticationHttpAdapter } from "./auth/http-adapter.js";
import type { ApiPlatformHttpComposition, AuthorizedOperationContext } from "./composition.js";

export const applicationId = "@ai-crm/api" as const;
const API_COMPOSITION = Symbol("api-composition");
const API_RUNTIME_STATE = Symbol("api-runtime-state");
interface ApiRuntimeState { ready: boolean; }

export interface ApiComposition {
  readonly authentication?: PcAuthenticationHttpAdapter;
  readonly authenticationCallbackUrl?: (requestPathAndQuery: string) => string;
  readonly dependencies?: () => readonly HealthDependency[];
  readonly logger: ApplicationLogger;
  readonly onStart?: (signal: AbortSignal) => void | Promise<void>;
  readonly onStop?: () => void | Promise<void>;
  readonly platformHttp?: Readonly<ApiPlatformHttpComposition>;
  readonly shutdownTimeoutMs?: number;
  readonly startupTimeoutMs?: number;
}

interface PlatformHttpResponse {
  readonly body?: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

function sendPlatformResponse(response: Response, result: PlatformHttpResponse): void {
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  if (result.body === undefined) response.status(result.status).send();
  else response.status(result.status).json(result.body);
}

function stableActorId(context: Readonly<AuthorizedOperationContext>): string {
  const subject = context.principal.authenticationSubject;
  return `subject:${createHash("sha256").update(`${subject.issuer}\0${subject.subject}`).digest("hex")}`;
}

function credentialFromRequest(request: Request): string | undefined {
  const cookie = singleHeader(request, "cookie", 4096);
  if (!cookie.valid) return undefined;
  try { return parsePcSessionCredential(cookie.value); } catch { return undefined; }
}

function platformHeader(request: Request, name: string, maximumLength: number, minimumLength = 0): string | undefined {
  const result = singleHeader(request, name, maximumLength, minimumLength);
  return result.valid ? result.value : undefined;
}

interface RequestValue {
  readonly valid: boolean;
  readonly value?: string;
}

function singleHeader(request: Request, name: string, maximumLength: number, minimumLength = 0): RequestValue {
  let occurrences = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) occurrences += 1;
  }
  const value = request.headers[name];
  if (occurrences > 1 || Array.isArray(value)) return { valid: false };
  if (value === undefined) return { valid: minimumLength === 0 };
  return {
    valid: value.length >= minimumLength && value.length <= maximumLength && !/[\0\r\n]/u.test(value),
    value,
  };
}

function singleQuery(request: Request, name: string, maximumLength: number, minimumLength = 0): RequestValue {
  const value = request.query[name];
  if (value === undefined) return { valid: minimumLength === 0 };
  if (typeof value !== "string") return { valid: false };
  return { valid: value.length >= minimumLength && value.length <= maximumLength, value };
}

function sendAuthenticationResponse(response: Response, result: AuthenticationHttpResponse): void {
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  if (result.body === undefined) response.status(result.status).send();
  else response.status(result.status).json(result.body);
}

const invalidCallbackResponse: AuthenticationHttpResponse = Object.freeze({
  body: Object.freeze({ code: "authentication_callback_invalid", message: "The authentication callback is invalid or expired." }),
  headers: Object.freeze({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }),
  status: 400,
});
const invalidCsrfResponse: AuthenticationHttpResponse = Object.freeze({
  body: Object.freeze({ code: "authentication_csrf_rejected", message: "The browser request failed security validation." }),
  headers: Object.freeze({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }),
  status: 403,
});
const invalidSessionResponse: AuthenticationHttpResponse = Object.freeze({
  body: Object.freeze({ code: "authentication_required", message: "Authentication is required." }),
  headers: Object.freeze({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }),
  status: 401,
});

@Controller("auth/pc")
class PcAuthenticationController {
  constructor(@Inject(API_COMPOSITION) private readonly composition: ApiComposition) {}

  private adapter(): PcAuthenticationHttpAdapter {
    if (this.composition.authentication === undefined) throw new Error("api_authentication_binding_missing");
    return this.composition.authentication;
  }

  @Get("login")
  async login(@Req() request: Request, @Res() response: Response): Promise<void> {
    const returnTo = singleQuery(request, "returnTo", 512);
    if (!returnTo.valid) {
      sendAuthenticationResponse(response, invalidCallbackResponse);
      return;
    }
    sendAuthenticationResponse(response, await this.adapter().beginLogin(returnTo.value));
  }

  @Get("callback")
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    const code = singleQuery(request, "code", 4096, 1);
    const state = singleQuery(request, "state", 512, 32);
    if (!code.valid || !state.valid) {
      sendAuthenticationResponse(response, invalidCallbackResponse);
      return;
    }
    const callbackUrl = this.composition.authenticationCallbackUrl?.(request.originalUrl);
    if (callbackUrl === undefined) throw new Error("api_authentication_callback_binding_missing");
    sendAuthenticationResponse(response, await this.adapter().completeLogin(callbackUrl));
  }

  @Get("session")
  async session(@Req() request: Request, @Res() response: Response): Promise<void> {
    const cookie = singleHeader(request, "cookie", 4096);
    if (!cookie.valid) {
      sendAuthenticationResponse(response, invalidSessionResponse);
      return;
    }
    sendAuthenticationResponse(response, await this.adapter().currentSession(cookie.value));
  }

  @Post("refresh")
  async refresh(@Req() request: Request, @Res() response: Response): Promise<void> {
    const context = this.mutationContext(request, true);
    if (context.error) {
      sendAuthenticationResponse(response, context.error);
      return;
    }
    sendAuthenticationResponse(response, await this.adapter().refresh(context.value));
  }

  @Post("logout")
  async logout(@Req() request: Request, @Res() response: Response): Promise<void> {
    const context = this.mutationContext(request, false);
    if (context.error) {
      sendAuthenticationResponse(response, context.error);
      return;
    }
    sendAuthenticationResponse(response, await this.adapter().logout(context.value));
  }

  private mutationContext(request: Request, csrfRequired: boolean):
    | { readonly error: AuthenticationHttpResponse; readonly value?: never }
    | { readonly error?: never; readonly value: BrowserRequestContext } {
    const cookie = singleHeader(request, "cookie", 4096);
    if (!cookie.valid) return { error: invalidSessionResponse };
    const csrfToken = singleHeader(request, "x-csrf-token", 512, csrfRequired ? 32 : 0);
    const origin = singleHeader(request, "origin", 512);
    const referer = singleHeader(request, "referer", 2048);
    if (!csrfToken.valid || !origin.valid || !referer.valid) return { error: invalidCsrfResponse };
    return { value: { cookie: cookie.value, csrfToken: csrfToken.value, origin: origin.value, referer: referer.value } };
  }
}

function platform(composition: ApiComposition): Readonly<ApiPlatformHttpComposition> {
  if (composition.platformHttp === undefined) throw new Error("api_platform_http_binding_missing");
  return composition.platformHttp;
}

function registryAuthorizationFailure(error: unknown): PlatformHttpResponse {
  const unavailable = error instanceof BrowserSessionFailure && error.code === "authentication_dependency_unavailable";
  const unauthorized = error instanceof BrowserSessionFailure && !unavailable;
  const forbidden = !unauthorized && !unavailable && typeof error === "object" && error !== null &&
    (Reflect.get(error, "name") === "AuthorizationDeniedError" ||
      ["subject_not_associated", "employment_not_active", "assignment_not_active"].includes(String(Reflect.get(error, "code"))));
  const status = unauthorized ? 401 : forbidden ? 403 : 503;
  const code = unauthorized ? "app_registry_unauthorized" : forbidden ? "app_registry_denied" : "app_registry_unavailable";
  return Object.freeze({
    body: Object.freeze({ code }),
    headers: Object.freeze({ "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'" }),
    status,
  });
}

@Controller("application-registry")
class ApplicationRegistryController {
  constructor(@Inject(API_COMPOSITION) private readonly composition: ApiComposition) {}

  private async context(request: Request, permission: PermissionRequest): Promise<Readonly<{
    readonly activeAssignmentIds: readonly string[];
    readonly actorId: string;
    readonly traceId: string;
    readonly workforcePersonId: string;
  }>> {
    const credential = credentialFromRequest(request);
    if (credential === undefined) throw new BrowserSessionFailure("authentication_session_invalid");
    const traceId = extractTraceContext({ traceparent: platformHeader(request, "traceparent", 512) }).traceId;
    const authorized = await platform(this.composition).authorize({
      at: new Date().toISOString(),
      credential,
      permission,
      traceId,
    });
    return Object.freeze({
      activeAssignmentIds: Object.freeze(authorized.workforce.assignments.map((assignment) => assignment.assignmentId)),
      actorId: stableActorId(authorized),
      traceId,
      workforcePersonId: authorized.workforce.workforcePersonId,
    });
  }

  @Get()
  async load(@Req() request: Request, @Res() response: Response): Promise<void> {
    try {
      const context = await this.context(request, { action: "read", resource: "platform.app-registry.registry" });
      sendPlatformResponse(response, await platform(this.composition).applicationRegistry.loadRegistry(context));
    } catch (error) { sendPlatformResponse(response, registryAuthorizationFailure(error)); }
  }

  @Post("deep-links/resolve")
  async resolve(@Req() request: Request, @Res() response: Response): Promise<void> {
    try {
      const context = await this.context(request, { action: "resolve", resource: "platform.app-registry.deep-link" });
      sendPlatformResponse(response, await platform(this.composition).applicationRegistry.resolveDeepLink(context, request.body));
    } catch (error) { sendPlatformResponse(response, registryAuthorizationFailure(error)); }
  }
}

@Controller("form-definitions")
class FormSchemaController {
  constructor(@Inject(API_COMPOSITION) private readonly composition: ApiComposition) {}

  private request(request: Request): Parameters<ApiPlatformHttpComposition["forms"]["handle"]>[0] {
    const rawBody = Reflect.get(request, "rawBody") as unknown;
    const contentType = platformHeader(request, "content-type", 128);
    const credential = credentialFromRequest(request);
    const traceparent = platformHeader(request, "traceparent", 512);
    return {
      at: new Date().toISOString(),
      ...(rawBody instanceof Uint8Array ? { body: rawBody } : {}),
      ...(contentType === undefined ? {} : { contentType }),
      ...(credential === undefined ? {} : { credential }),
      method: request.method,
      path: request.path,
      ...(traceparent === undefined ? {} : { traceparent }),
    };
  }

  @Get(":definitionId/releases/:releaseVersion")
  async release(@Req() request: Request, @Res() response: Response): Promise<void> {
    sendPlatformResponse(response, await platform(this.composition).forms.handle(this.request(request)));
  }

  @Post(":definitionId/releases/:releaseVersion/validate")
  async validate(@Req() request: Request, @Res() response: Response): Promise<void> {
    sendPlatformResponse(response, await platform(this.composition).forms.handle(this.request(request)));
  }
}

@Controller("files")
class FileCenterController {
  constructor(@Inject(API_COMPOSITION) private readonly composition: ApiComposition) {}

  private context(request: Request) {
    return Object.freeze({
      cookie: platformHeader(request, "cookie", 4096),
      csrfToken: platformHeader(request, "x-csrf-token", 512),
      idempotencyKey: platformHeader(request, "idempotency-key", 64),
      origin: platformHeader(request, "origin", 512),
      referer: platformHeader(request, "referer", 2048),
      traceparent: platformHeader(request, "traceparent", 512),
    });
  }

  @Post("upload-sessions")
  async createUpload(@Req() request: Request, @Res() response: Response): Promise<void> {
    sendPlatformResponse(response, await platform(this.composition).fileCenter.createUpload(this.context(request), request.body));
  }

  @Post("upload-sessions/:sessionId/confirm")
  async confirmUpload(@Req() request: Request, @Res() response: Response): Promise<void> {
    sendPlatformResponse(response, await platform(this.composition).fileCenter.confirmUpload(this.context(request), request.params["sessionId"]));
  }

  @Post("download-grants")
  async download(@Req() request: Request, @Res() response: Response): Promise<void> {
    sendPlatformResponse(response, await platform(this.composition).fileCenter.authorizeDownload(this.context(request), request.body));
  }
}

const unavailableDependency = Object.freeze([{ name: "dependency-check", required: true, healthy: false }]);
function apiDependencies(composition: ApiComposition): readonly HealthDependency[] {
  try {
    return composition.dependencies?.() ?? [];
  } catch {
    composition.logger.log("error", { errorCode: "api_dependency_check_failed", operation: "api.health.dependencies", outcome: "failed" });
    return unavailableDependency;
  }
}

@Controller("health")
class HealthController {
  constructor(
    @Inject(API_COMPOSITION) private readonly composition: ApiComposition,
    @Inject(API_RUNTIME_STATE) private readonly state: ApiRuntimeState,
  ) {}

  @Get("live")
  liveness(): HealthResult { return evaluateHealth("liveness"); }

  @Get("ready")
  readiness(@Res() response: Response): void {
    const result = this.state.ready
      ? evaluateHealth("readiness", apiDependencies(this.composition))
      : { status: "unavailable" as const };
    response.status(result.status === "ok" ? 200 : 503).json(result);
  }
}

@Injectable()
class ApiLifecycle implements OnApplicationShutdown {
  constructor(@Inject(API_COMPOSITION) private readonly composition: ApiComposition) {}
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.composition.onStop?.();
      this.composition.logger.log("info", { operation: "api.lifecycle.stop", outcome: "succeeded" });
    } catch (error) {
      this.composition.logger.log("error", { errorCode: "api_stop_failed", operation: "api.lifecycle.stop", outcome: "failed" });
      throw error;
    }
  }
}

@Module({})
// Nest requires a class as the module token; behavior is supplied by the dynamic module below.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class ApiModule {}

const createApiModule = (composition: ApiComposition, state: ApiRuntimeState): DynamicModule => ({
  controllers: [HealthController, PcAuthenticationController, ApplicationRegistryController, FormSchemaController, FileCenterController],
  module: ApiModule,
  providers: [
    { provide: API_COMPOSITION, useValue: composition },
    { provide: API_RUNTIME_STATE, useValue: state },
    ApiLifecycle,
  ],
});

export interface ApiApplication {
  readonly health: (kind: "liveness" | "readiness") => HealthResult;
  readonly instance: () => INestApplication | undefined;
  readonly start: (port?: number, host?: string) => Promise<void>;
  readonly stop: () => Promise<void>;
}

async function apiSettleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<{ readonly kind: "completed"; readonly value: T } | { readonly kind: "timeout" }> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ kind: "completed" as const, value })),
      new Promise<{ readonly kind: "timeout" }>((resolve) => { timeout = setTimeout(() => { resolve({ kind: "timeout" }); }, timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const createApiApplication = (composition: ApiComposition): ApiApplication => {
  let application: INestApplication | undefined;
  let activeStart = 0;
  let startPromise: Promise<void> | undefined;
  let startController: AbortController | undefined;
  let stopping: Promise<void> | undefined;
  let terminal = false;
  const state: ApiRuntimeState = { ready: false };
  const startupTimeoutMs = composition.startupTimeoutMs ?? 30_000;
  const shutdownTimeoutMs = composition.shutdownTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 300_000) throw new Error("api_startup_timeout_invalid");
  if (!Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1 || shutdownTimeoutMs > 300_000) throw new Error("api_shutdown_timeout_invalid");
  const health = (kind: "liveness" | "readiness"): HealthResult =>
    kind === "readiness" && !state.ready
      ? { status: "unavailable" }
      : evaluateHealth(kind, apiDependencies(composition));
  const start = async (port = 3000, host = "0.0.0.0"): Promise<void> => {
    if (stopping) await stopping;
    if (application) return;
    if (startPromise) return startPromise;
    if (terminal) throw new Error("api_terminal");
    startPromise = (async () => {
      const startId = ++activeStart;
      let candidate: INestApplication | undefined;
      let candidateClose: Promise<void> | undefined;
      let initialize: Promise<void> | undefined;
      let stopHook: Promise<void> | undefined;
      const controller = new AbortController();
      startController = controller;
      const cancelled = (): boolean => controller.signal.aborted || startId !== activeStart;
      const closeCandidate = async (): Promise<void> => {
        const candidateToClose = candidate;
        if (candidateToClose && !candidateClose) candidateClose = Promise.resolve().then(async () => { await candidateToClose.close(); });
        await candidateClose;
      };
      const stopAttempt = async (): Promise<void> => {
        stopHook ??= Promise.resolve().then(async () => { await composition.onStop?.(); });
        await stopHook;
      };
      const attemptComposition: ApiComposition = { ...composition, onStop: stopAttempt };
      try {
        composition.logger.log("info", { operation: "api.lifecycle.start", outcome: "started" });
        initialize = (async (): Promise<void> => {
          await composition.onStart?.(controller.signal);
          if (cancelled()) throw new Error("api_start_cancelled");
          const created = await NestFactory.create<NestExpressApplication>(createApiModule(attemptComposition, state), {
            abortOnError: false,
            bodyParser: false,
            logger: false,
            rawBody: true,
          });
          created.useBodyParser("json", { limit: 262_144 });
          candidate = created;
          if (cancelled()) {
            await closeCandidate();
            throw new Error("api_start_cancelled");
          }
          await candidate.listen(port, host);
          if (cancelled()) {
            await closeCandidate();
            throw new Error("api_start_cancelled");
          }
        })();
        const startupResult = await apiSettleWithin(initialize, startupTimeoutMs);
        if (startupResult.kind === "timeout") throw new Error("api_start_timeout");
        if (cancelled() || !candidate) throw new Error("api_start_cancelled");
        application = candidate;
        if (startId === activeStart) state.ready = true;
        composition.logger.log("info", { operation: "api.lifecycle.start", outcome: "succeeded" });
      } catch (error) {
        controller.abort();
        if (startId === activeStart) activeStart += 1;
        state.ready = false;
        composition.logger.log("error", { errorCode: "api_start_failed", operation: "api.lifecycle.start", outcome: "failed" });
        const cleanup = Promise.allSettled([initialize ?? Promise.resolve(), closeCandidate(), stopAttempt()]);
        const cleanupResult = await apiSettleWithin(cleanup, startupTimeoutMs);
        if (cleanupResult.kind === "timeout" || cleanupResult.value.some((result) => result.status === "rejected")) {
          terminal = true;
          composition.logger.log("error", { errorCode: "api_start_cleanup_failed", operation: "api.lifecycle.stop", outcome: "failed" });
        }
        application = undefined;
        throw error;
      }
    })().finally(() => { startController = undefined; startPromise = undefined; });
    return startPromise;
  };
  const stop = async (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      state.ready = false;
      try {
        if (startPromise) {
          activeStart += 1;
          startController?.abort();
          const startupResult = await apiSettleWithin(
            startPromise.then(() => undefined, () => undefined),
            shutdownTimeoutMs,
          );
          if (startupResult.kind === "timeout") throw new Error("api_stop_timeout");
        }
        const stoppingApplication = application;
        application = undefined;
        if (!stoppingApplication) return;
        const closeResult = await apiSettleWithin(Promise.allSettled([stoppingApplication.close()]), shutdownTimeoutMs);
        if (closeResult.kind === "timeout") throw new Error("api_stop_timeout");
        if (closeResult.value.some((result) => result.status === "rejected")) throw new Error("api_stop_failed");
      } catch (error) {
        terminal = true;
        application = undefined;
        composition.logger.log("error", {
          errorCode: error instanceof Error && error.message === "api_stop_timeout" ? "api_stop_timeout" : "api_stop_failed",
          operation: "api.lifecycle.stop",
          outcome: "failed",
        });
        throw error;
      }
    })().finally(() => { stopping = undefined; });
    return stopping;
  };
  return { health, instance: () => application, start, stop };
};

export * from "./auth/index.js";
export {
  createApiPlatformComposition,
  type ApiPlatformBindings,
  type ApiPlatformComposition,
  type ApiQueryBindings,
  type AuthorizedOperationContext,
  type DatabaseMigrationCompatibility,
  type ProtectedOperationInput,
} from "./composition.js";
export { loadApiRuntimeConfiguration, type ApiRuntimeConfiguration } from "./runtime-config.js";
export { loadProductionApiConfiguration, type ProductionApiConfiguration } from "./production-config.js";
export {
  bootstrapApiProcess,
  runApiMain,
  type ApiProcessPort,
  type BootstrapApiProcessOptions,
  type RunApiMainOptions,
  type RunningApiProcess,
} from "./main.js";
export {
  createProductionApiPlatformBindings,
  defaultApiPlatformBindingFactory,
  type ApiPlatformBindingFactory,
  type ProductionApiBindingDependencies,
} from "./composition-factory.js";
