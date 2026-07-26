import { WorkflowError, type WorkflowErrorCode } from "./errors.js";
import type {
  FlowableRestConfig,
  ProcessDefinition,
  ProcessInstance,
  ProcessInstanceStatus,
  WorkflowEngine,
  WorkflowTask,
  WorkflowTaskStatus,
  WorkflowVariable,
} from "./types.js";

type Data = Record<string, unknown>;

const MAX_RESPONSE_BYTES = 1_000_000;
const SAFE_DEFINITION_KEY = /^[a-z][A-Za-z0-9._-]{0,127}$/u;
const object = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 ? value : undefined;
const integer = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
const protocol = (cause?: unknown): WorkflowError => new WorkflowError("WORKFLOW_ENGINE_PROTOCOL_ERROR", cause === undefined ? {} : { cause });
const reconciliation = (cause: unknown): WorkflowError => new WorkflowError("WORKFLOW_RECONCILIATION_REQUIRED", { cause });
const hasControl = (value: string): boolean => { for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); if (code < 32 || code === 127) return true; } return false; };
const requiredString = (value: unknown, maximum = 255): string => {
  const parsed = string(value);
  if (parsed === undefined || parsed.length > maximum || hasControl(parsed)) throw protocol();
  return parsed;
};
const requiredNumber = (value: unknown): number => {
  const parsed = integer(value);
  if (parsed === undefined || parsed < 1) throw protocol();
  return parsed;
};
const optionalTimestamp = (value: unknown): string | undefined => {
  const parsed = string(value);
  if (parsed === undefined) return undefined;
  const timestamp = new Date(parsed);
  if (Number.isNaN(timestamp.valueOf())) throw protocol();
  return timestamp.toISOString();
};
const data = (value: unknown): Data[] => {
  if (!object(value) || !Array.isArray(value["data"]) || !value["data"].every(object)) throw protocol();
  return value["data"];
};
const variableType = (value: WorkflowVariable): "boolean" | "double" | "string" => typeof value === "boolean" ? "boolean" : typeof value === "number" ? "double" : "string";
const variablePayload = (variables: Readonly<Record<string, WorkflowVariable>>) => Object.entries(variables).map(([name, value]) => ({ name, type: variableType(value), value }));
const base = (input: string): URL => {
  let url: URL;
  try { url = new URL(input); } catch (error) { throw new WorkflowError("WORKFLOW_INVALID_INPUT", { cause: error }); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new WorkflowError("WORKFLOW_INVALID_INPUT");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
};
const definition = (row: Data): ProcessDefinition => Object.freeze({
  definitionId: requiredString(row["id"]),
  deploymentId: requiredString(row["deploymentId"]),
  key: (() => { const value = requiredString(row["key"], 128); if (!SAFE_DEFINITION_KEY.test(value)) throw protocol(); return value; })(),
  resourceName: requiredString(row["resource"]),
  version: requiredNumber(row["version"]),
});
const task = (row: Data, status: WorkflowTaskStatus = "active"): WorkflowTask => {
  const assigneeReference = string(row["assignee"]);
  if (assigneeReference !== undefined && assigneeReference.length > 255) throw protocol();
  const createdAt = optionalTimestamp(row["createTime"] ?? row["startTime"]);
  const endedAt = optionalTimestamp(row["endTime"]);
  return Object.freeze({
    definitionId: requiredString(row["processDefinitionId"]),
    processInstanceId: requiredString(row["processInstanceId"]),
    status,
    taskDefinitionKey: requiredString(row["taskDefinitionKey"]),
    taskId: requiredString(row["id"]),
    ...(assigneeReference === undefined ? {} : { assigneeReference }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
  });
};
const historicTaskStatus = (row: Data): WorkflowTaskStatus => {
  const reason = string(row["deleteReason"])?.toLowerCase();
  if (reason?.includes("expire") === true || reason?.includes("timeout") === true) return "expired";
  if (reason !== undefined) return "cancelled";
  return string(row["endTime"]) === undefined ? "active" : "completed";
};
const readBody = async (response: Response): Promise<string> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const bytes = Number(contentLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_RESPONSE_BYTES) throw protocol();
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      total += result.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw protocol();
      }
      chunks.push(result.value);
      result = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (error) { throw protocol(error); }
};

export const createFlowableRestEngine = (config: FlowableRestConfig): WorkflowEngine => {
  const baseUrl = base(config.baseUrl);
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 120_000 || config.username.length < 1 || config.username.length > 128 || config.password.length < 1 || config.password.length > 1024) throw new WorkflowError("WORKFLOW_INVALID_INPUT");
  const fetcher = config.fetch ?? fetch;
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`;
  const request = async (path: string, init: RequestInit = {}, notFound: WorkflowErrorCode = "WORKFLOW_ENGINE_REJECTED", mutation = false): Promise<unknown> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", authorization);
    headers.set("accept", "application/json");
    if (init.body !== undefined && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
    try {
      const response = await fetcher(new URL(path, baseUrl), { ...init, headers, redirect: "error", signal: AbortSignal.timeout(config.timeoutMs) });
      if (!response.ok) {
        if (response.status === 404) throw new WorkflowError(notFound);
        if (response.status === 409) throw new WorkflowError("WORKFLOW_CONFLICT");
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          if (mutation) throw reconciliation(new WorkflowError("WORKFLOW_ENGINE_UNAVAILABLE", { retryable: true }));
          throw new WorkflowError("WORKFLOW_ENGINE_UNAVAILABLE", { retryable: true });
        }
        throw new WorkflowError("WORKFLOW_ENGINE_REJECTED");
      }
      if (response.status === 204) return undefined;
      const body = await readBody(response);
      if (body.length === 0) return undefined;
      if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw protocol();
      try { return JSON.parse(body) as unknown; } catch (error) { throw protocol(error); }
    } catch (error) {
      if (error instanceof WorkflowError) {
        if (mutation && error.code === "WORKFLOW_ENGINE_PROTOCOL_ERROR") throw reconciliation(error);
        throw error;
      }
      const mapped = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
        ? new WorkflowError("WORKFLOW_ENGINE_TIMEOUT", { cause: error, retryable: true })
        : new WorkflowError("WORKFLOW_ENGINE_UNAVAILABLE", { cause: error, retryable: true });
      if (mutation) throw reconciliation(mapped);
      throw mapped;
    }
  };
  const traced = (traceparent: string | undefined): Headers => {
    const headers = new Headers();
    if (traceparent !== undefined) headers.set("traceparent", traceparent);
    return headers;
  };
  const definitionById = async (id: string, traceparent?: string): Promise<ProcessDefinition> => {
    const value = await request(`repository/process-definitions/${encodeURIComponent(id)}`, { headers: traced(traceparent) }, "WORKFLOW_DEFINITION_NOT_FOUND");
    if (!object(value)) throw protocol();
    return definition(value);
  };
  const instance = async (row: Data, status: ProcessInstanceStatus, traceparent?: string): Promise<ProcessInstance> => {
    const processDefinition = await definitionById(requiredString(row["processDefinitionId"]), traceparent);
    const startedAt = optionalTimestamp(row["startTime"]);
    const endedAt = optionalTimestamp(row["endTime"]);
    return Object.freeze({
      definitionId: processDefinition.definitionId,
      definitionKey: processDefinition.key,
      definitionVersion: processDefinition.version,
      processInstanceId: requiredString(row["id"]),
      status,
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
    });
  };
  const afterWrite = async <T>(action: () => Promise<T>): Promise<T> => {
    try { return await action(); } catch (error) { throw reconciliation(error); }
  };
  const engine: WorkflowEngine = {
    async cancelProcess(id, reason, traceparent) { await request(`runtime/process-instances/${encodeURIComponent(id)}?deleteReason=${encodeURIComponent(reason)}`, { headers: traced(traceparent), method: "DELETE" }, "WORKFLOW_INSTANCE_NOT_FOUND", true); },
    async claimTask(id, assignee, traceparent) { await request(`runtime/tasks/${encodeURIComponent(id)}`, { body: JSON.stringify({ action: "claim", assignee }), headers: traced(traceparent), method: "POST" }, "WORKFLOW_TASK_NOT_FOUND", true); return afterWrite(() => engine.getTask(id, traceparent)); },
    async completeTask(id, variables, traceparent) { await request(`runtime/tasks/${encodeURIComponent(id)}`, { body: JSON.stringify({ action: "complete", variables: variablePayload(variables) }), headers: traced(traceparent), method: "POST" }, "WORKFLOW_TASK_NOT_FOUND", true); return afterWrite(() => engine.getTask(id, traceparent)); },
    async deployDefinition(input) {
      const form = new FormData();
      form.set("deploymentName", input.assetName);
      form.set("file", new Blob([input.bpmnXml], { type: "application/xml" }), input.assetName);
      const deployed = await request("repository/deployments", { body: form, headers: traced(input.traceparent), method: "POST" }, "WORKFLOW_ENGINE_REJECTED", true);
      return afterWrite(async () => {
        if (!object(deployed)) throw protocol();
        const deploymentId = requiredString(deployed["id"]);
        const rows = data(await request(`repository/process-definitions?deploymentId=${encodeURIComponent(deploymentId)}`, { headers: traced(input.traceparent) }));
        if (rows.length !== 1 || rows[0] === undefined || rows[0]["key"] !== input.definitionKey) throw protocol();
        return definition(rows[0]);
      });
    },
    async getDefinition(key, version, traceparent) { const rows = data(await request(`repository/process-definitions?key=${encodeURIComponent(key)}&version=${String(version)}`, { headers: traced(traceparent) })); if (rows.length === 0) throw new WorkflowError("WORKFLOW_UNKNOWN_DEFINITION_VERSION"); if (rows.length !== 1 || rows[0] === undefined) throw protocol(); return definition(rows[0]); },
    async getInstance(id, traceparent) { try { const current = await request(`runtime/process-instances/${encodeURIComponent(id)}`, { headers: traced(traceparent) }, "WORKFLOW_INSTANCE_NOT_FOUND"); if (!object(current)) throw protocol(); return await instance(current, "active", traceparent); } catch (error) { if (!(error instanceof WorkflowError) || error.code !== "WORKFLOW_INSTANCE_NOT_FOUND") throw error; } const historic = await request(`history/historic-process-instances/${encodeURIComponent(id)}`, { headers: traced(traceparent) }, "WORKFLOW_INSTANCE_NOT_FOUND"); if (!object(historic)) throw protocol(); return instance(historic, string(historic["deleteReason"]) === undefined ? "completed" : "cancelled", traceparent); },
    async getTask(id, traceparent) { try { const current = await request(`runtime/tasks/${encodeURIComponent(id)}`, { headers: traced(traceparent) }, "WORKFLOW_TASK_NOT_FOUND"); if (!object(current)) throw protocol(); return task(current); } catch (error) { if (!(error instanceof WorkflowError) || error.code !== "WORKFLOW_TASK_NOT_FOUND") throw error; } const historic = await request(`history/historic-task-instances/${encodeURIComponent(id)}`, { headers: traced(traceparent) }, "WORKFLOW_TASK_NOT_FOUND"); if (!object(historic)) throw protocol(); return task(historic, historicTaskStatus(historic)); },
    async health() { try { await request("management/engine"); return Object.freeze({ status: "available" as const }); } catch { return Object.freeze({ status: "unavailable" as const }); } },
    async listTasks(id, traceparent) { return Object.freeze(data(await request(`runtime/tasks?processInstanceId=${encodeURIComponent(id)}`, { headers: traced(traceparent) })).map((row) => task(row))); },
    async releaseTask(id, traceparent) { await request(`runtime/tasks/${encodeURIComponent(id)}`, { body: JSON.stringify({ action: "claim", assignee: null }), headers: traced(traceparent), method: "POST" }, "WORKFLOW_TASK_NOT_FOUND", true); return afterWrite(() => engine.getTask(id, traceparent)); },
    async startProcess(input) { const value = await request("runtime/process-instances", { body: JSON.stringify({ businessKey: input.businessKey, processDefinitionId: input.definition.definitionId, variables: variablePayload(input.variables) }), headers: traced(input.traceparent), method: "POST" }, "WORKFLOW_ENGINE_REJECTED", true); return afterWrite(async () => { if (!object(value)) throw protocol(); return instance(value, "active", input.traceparent); }); },
  };
  return Object.freeze(engine);
};
