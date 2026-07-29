export type HealthCheckKind = "liveness" | "readiness" | "diagnostic";

export interface HealthDependency {
  readonly name: string;
  readonly required: boolean;
  readonly healthy: boolean;
}

export interface HealthResult {
  readonly status: "ok" | "unavailable";
  readonly checks?: Readonly<Record<string, "ok" | "unavailable">>;
}

const CHECK_NAME = /^[a-z][a-z0-9_.-]{0,63}$/u;

export function evaluateHealth(
  kind: HealthCheckKind,
  dependencies: readonly HealthDependency[] = [],
): Readonly<HealthResult> {
  if (kind === "liveness") {
    return Object.freeze({ status: "ok" });
  }
  const safeDependencies = dependencies.filter((dependency) => CHECK_NAME.test(dependency.name));
  // Diagnostic-name filtering must never remove a required dependency from the
  // availability decision. An invalid name is itself unsafe for a required
  // dependency because operators cannot identify it from the bounded response.
  const unavailable = dependencies.some(
    (dependency) => dependency.required && !dependency.healthy,
  ) || dependencies.some((dependency) => dependency.required && !CHECK_NAME.test(dependency.name));
  if (kind === "readiness") {
    return Object.freeze({ status: unavailable ? "unavailable" : "ok" });
  }
  const checks: Record<string, "ok" | "unavailable"> = {};
  for (const dependency of safeDependencies) {
    const status = dependency.healthy ? "ok" : "unavailable";
    if (checks[dependency.name] !== "unavailable") checks[dependency.name] = status;
  }
  return Object.freeze({
    checks: Object.freeze(checks),
    status: unavailable ? "unavailable" : "ok",
  });
}
