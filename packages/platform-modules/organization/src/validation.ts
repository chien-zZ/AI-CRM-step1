import { OrganizationError } from "./errors.js";
import type { EffectiveInterval } from "./types.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function requireId(value: string): void {
  if (!uuid.test(value)) throw new OrganizationError("entity_conflict");
}

export function requireText(value: string, maximum = 255): void {
  if (value.trim().length === 0 || value.length > maximum) throw new OrganizationError("entity_conflict");
}

export function requireTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new OrganizationError("effective_interval_invalid");
  }
  return parsed;
}

export function requireInterval(interval: EffectiveInterval): void {
  const from = requireTimestamp(interval.effectiveFrom);
  if (interval.effectiveTo !== undefined && requireTimestamp(interval.effectiveTo) <= from) {
    throw new OrganizationError("effective_interval_invalid");
  }
}

export function isActive(interval: EffectiveInterval, at: string): boolean {
  const instant = Date.parse(at);
  return Date.parse(interval.effectiveFrom) <= instant
    && (interval.effectiveTo === undefined || instant < Date.parse(interval.effectiveTo));
}

export function intervalsOverlap(left: EffectiveInterval, right: EffectiveInterval): boolean {
  const leftEnd = left.effectiveTo ? Date.parse(left.effectiveTo) : Number.POSITIVE_INFINITY;
  const rightEnd = right.effectiveTo ? Date.parse(right.effectiveTo) : Number.POSITIVE_INFINITY;
  return Date.parse(left.effectiveFrom) < rightEnd && Date.parse(right.effectiveFrom) < leftEnd;
}

export function intervalContains(container: EffectiveInterval, contained: EffectiveInterval): boolean {
  if (Date.parse(container.effectiveFrom) > Date.parse(contained.effectiveFrom)) return false;
  if (container.effectiveTo === undefined) return true;
  return contained.effectiveTo !== undefined && Date.parse(contained.effectiveTo) <= Date.parse(container.effectiveTo);
}
