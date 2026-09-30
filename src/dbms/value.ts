import type { Data } from "../types/types.js";
import { fail } from "./errors.js";

// JSON values are the on-disk contract. Reject values JSON.stringify would silently change.
export function assertJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || value === null)
    fail("TYPE", "Only finite JSON data is supported");
  if (seen.has(value)) fail("TYPE", "Cyclic JSON value");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    fail("TYPE", "JSON objects must be plain objects");
  if (Object.getOwnPropertySymbols(value).length) fail("TYPE", "Symbol keys are not JSON data");
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertJson(value[i], seen);
  } else {
    for (const v of Object.values(value)) assertJson(v, seen);
  }
  seen.delete(value);
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

// Canonical object ordering makes JSON equality, compound keys and indexes agree.
export function key(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(key).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + key((value as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

export function compare(a: Data, b: Data): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  const x = typeof a === "object" ? key(a) : a;
  const y = typeof b === "object" ? key(b) : b;
  return x < y ? -1 : x > y ? 1 : 0;
}
