import type { ConditionNode, Data, Row } from "../types/types.js";
import { fail } from "./errors.js";
import { assertJson, key } from "./value.js";

export type Truth = boolean | null;
export type Where = ConditionNode | Record<string, Data>;

const comparison = (
  column: string,
  operator: "=" | "!=" | "<" | ">" | "<=" | ">=" | "LIKE",
  value: Data,
): ConditionNode => ({ type: "comparison", column, operator, value });
export const eq = (column: string, value: Data) => comparison(column, "=", value);
export const ne = (column: string, value: Data) => comparison(column, "!=", value);
export const lt = (column: string, value: Data) => comparison(column, "<", value);
export const lte = (column: string, value: Data) => comparison(column, "<=", value);
export const gt = (column: string, value: Data) => comparison(column, ">", value);
export const gte = (column: string, value: Data) => comparison(column, ">=", value);
export const like = (column: string, value: string) => comparison(column, "LIKE", value);
export const between = (column: string, low: Data, high: Data): ConditionNode => ({
  type: "comparison",
  column,
  operator: "BETWEEN",
  value: [low, high],
});
export const inList = (column: string, values: Data[]): ConditionNode => ({
  type: "comparison",
  column,
  operator: "IN",
  value: values,
});
export const isNull = (column: string): ConditionNode => ({
  type: "comparison",
  column,
  operator: "IS NULL",
});
export const isNotNull = (column: string): ConditionNode => ({
  type: "comparison",
  column,
  operator: "IS NOT NULL",
});
export const and = (...operands: ConditionNode[]): ConditionNode => ({
  type: "logical",
  operator: "AND",
  operands,
});
export const or = (...operands: ConditionNode[]): ConditionNode => ({
  type: "logical",
  operator: "OR",
  operands,
});
export const not = (operand: ConditionNode): ConditionNode => ({
  type: "logical",
  operator: "NOT",
  operands: [operand],
});

export function condition(where?: Where): ConditionNode | undefined {
  if (!where) return undefined;
  if ((where.type === "comparison" || where.type === "logical") && "operator" in where)
    return where as ConditionNode;
  return and(
    ...Object.entries(where).map(([column, value]) =>
      value === null ? isNull(column) : eq(column, value),
    ),
  );
}

export function validateCondition(node: ConditionNode | undefined, columns: string[]): void {
  if (!node) return;
  if (node.type === "logical") {
    if (
      !["AND", "OR", "NOT"].includes(node.operator) ||
      !Array.isArray(node.operands) ||
      (node.operator === "NOT" && node.operands.length !== 1)
    )
      fail("QUERY", "Invalid logical condition");
    node.operands.forEach((n) => validateCondition(n, columns));
    return;
  }
  if (node.type !== "comparison") fail("QUERY", "Invalid condition type");
  if (!columns.includes(node.column)) fail("COLUMN", `Unknown column: ${node.column}`);
  if (node.operator === "IS NULL" || node.operator === "IS NOT NULL") return;
  if (!["=", "!=", "<", ">", "<=", ">=", "LIKE", "IN", "BETWEEN"].includes(node.operator))
    fail("QUERY", "Invalid comparison operator");
  if (!("value" in node) || node.value === undefined) fail("QUERY", "Comparison requires a value");
  assertJson(node.value);
  if (node.operator === "LIKE" && typeof node.value !== "string")
    fail("QUERY", "LIKE requires text");
  if ((node.operator === "IN" || node.operator === "BETWEEN") && !Array.isArray(node.value))
    fail("QUERY", "Expected a value list");
  if (node.operator === "BETWEEN" && node.value!.length !== 2)
    fail("QUERY", "BETWEEN requires two bounds");
}

function equality(a: Data, b: Data): Truth {
  return a === null || b === null ? null : key(a) === key(b);
}
function range(a: Data, b: Data, op: string): Truth {
  if (a === null || b === null) return null;
  if (typeof a !== typeof b || (typeof a !== "string" && typeof a !== "number")) return false;
  if (op === "<") return a < b;
  if (op === ">") return a > b;
  if (op === "<=") return a <= b;
  return a >= b;
}
export function evaluate(node: ConditionNode, row: Row): Truth {
  if (node.type === "logical") {
    const results = node.operands.map((n) => evaluate(n, row));
    if (node.operator === "NOT") return results[0] === null ? null : !results[0];
    if (node.operator === "AND")
      return results.includes(false) ? false : results.includes(null) ? null : true;
    return results.includes(true) ? true : results.includes(null) ? null : false;
  }
  const v = row[node.column];
  if (node.operator === "IS NULL") return v === null;
  if (node.operator === "IS NOT NULL") return v !== null;
  if (!("value" in node)) fail("QUERY", "Comparison requires a value");
  const other = node.value!;
  if (node.operator === "=") return equality(v, other);
  if (node.operator === "!=") {
    const r = equality(v, other);
    return r === null ? null : !r;
  }
  if (node.operator === "IN") {
    const results = (other as Data[]).map((x) => equality(v, x));
    return results.includes(true) ? true : results.includes(null) ? null : false;
  }
  if (node.operator === "BETWEEN") {
    const bounds = other as [Data, Data];
    const a = range(v, bounds[0], ">="),
      b = range(v, bounds[1], "<=");
    return a === false || b === false ? false : a === null || b === null ? null : true;
  }
  if (node.operator === "LIKE") {
    if (v === null) return null;
    if (typeof v !== "string") return false;
    const pattern = (other as string)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, "[\\s\\S]*")
      .replace(/_/g, "[\\s\\S]");
    return new RegExp("^(?:" + pattern + ")(?![\\s\\S])", "u").test(v);
  }
  return range(v, other, node.operator);
}
