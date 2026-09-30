import type { Column, Row, Table } from "../types/types.js";
import { validateType } from "../types/datatype_validator.js";
import { fail } from "./errors.js";
import { assertJson, clone, key } from "./value.js";
import { evaluate, validateCondition } from "./conditions.js";

export type StoredRow = { id: number; value: Row };
export type State = {
  format: 1;
  revision: number;
  version: number;
  nextId: number;
  schema: Table[];
  rows: Record<string, StoredRow[]>;
};
export const primaryKey = (table: Table): string[] =>
  table.pk ? (typeof table.pk === "string" ? [table.pk] : table.pk) : [];
const namePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
export function assertName(name: string): void {
  if (
    typeof name !== "string" ||
    !namePattern.test(name) ||
    ["__proto__", "prototype", "constructor"].includes(name)
  )
    fail("SCHEMA", `Invalid identifier: ${name}`);
}

export function assertSchema(schema: readonly Table[]): void {
  assertJson(schema);
  if (!Array.isArray(schema as unknown)) fail("SCHEMA", "Schema must be a table array");
  const names = new Set<string>();
  for (const table of schema) {
    if (!table || typeof table !== "object") fail("SCHEMA", "Invalid table definition");
    assertName(table.name);
    if (names.has(table.name)) fail("SCHEMA", `Duplicate table: ${table.name}`);
    names.add(table.name);
    if (!Array.isArray(table.columns) || !table.columns.length)
      fail("SCHEMA", `Table ${table.name} needs columns`);
    const columns = new Set<string>();
    for (const c of table.columns) {
      if (!c || typeof c !== "object") fail("SCHEMA", "Invalid column definition");
      assertName(c.name);
      if (columns.has(c.name)) fail("SCHEMA", `Duplicate column: ${c.name}`);
      columns.add(c.name);
      if (!["boolean", "number", "text", "date", "time", "uuid", "jsonb"].includes(c.type))
        fail("SCHEMA", `Unknown type: ${c.type}`);
      if (
        (c.unique !== undefined && typeof c.unique !== "boolean") ||
        (c.notNull !== undefined && typeof c.notNull !== "boolean")
      )
        fail("SCHEMA", "Constraint flags must be boolean");
      if (c.unique && c.type === "jsonb") fail("SCHEMA", "JSON columns cannot be unique keys");
      if ("default" in c) validateValue(c, c.default!);
    }
    const pk = primaryKey(table);
    if (table.pk !== undefined && typeof table.pk !== "string" && !Array.isArray(table.pk))
      fail("SCHEMA", "Invalid primary key definition");
    if (table.pk !== undefined && !pk.length) fail("SCHEMA", "Empty primary key");
    const indexNames = new Set<string>();
    for (const property of ["indexes", "references", "checks"] as const) {
      if (table[property] !== undefined && !Array.isArray(table[property]))
        fail("SCHEMA", `Invalid ${property} definition`);
    }
    for (const index of table.indexes ?? []) {
      if (!index || !Array.isArray(index.columns)) fail("SCHEMA", "Invalid index definition");
      assertName(index.name);
      if (indexNames.has(index.name)) fail("SCHEMA", `Duplicate index: ${index.name}`);
      indexNames.add(index.name);
      assertKey(table, index.columns);
      if (index.unique !== undefined && typeof index.unique !== "boolean")
        fail("SCHEMA", "Index unique flag must be boolean");
    }
    if (pk.length) {
      assertKey(table, pk);
      for (const c of table.columns)
        if (pk.includes(c.name) && "default" in c) validateValue(c, c.default!, true);
    }
    for (const check of table.checks ?? []) {
      if (!check || typeof check !== "object") fail("SCHEMA", "Invalid check definition");
      validateCondition(check, [...columns]);
    }
  }
  for (const table of schema)
    for (const fk of table.references ?? []) {
      if (!fk || typeof fk !== "object") fail("SCHEMA", "Invalid foreign key definition");
      const target = schema.find((t) => t.name === fk.targetTable);
      if (!target) fail("SCHEMA", `Unknown referenced table: ${fk.targetTable}`);
      if (
        !Array.isArray(fk.pairs) ||
        !fk.pairs.length ||
        fk.pairs.some((p) => !p || typeof p.local !== "string" || typeof p.away !== "string")
      )
        fail("SCHEMA", "Foreign key needs column pairs");
      const local = fk.pairs.map((p) => p.local),
        away = fk.pairs.map((p) => p.away);
      assertKey(table, local);
      assertKey(target, away);
      for (const p of fk.pairs)
        if (
          table.columns.find((c) => c.name === p.local)!.type !==
          target.columns.find((c) => c.name === p.away)!.type
        )
          fail("SCHEMA", "Foreign key types differ");
      const candidates = [
        primaryKey(target),
        ...target.columns.filter((c) => c.unique).map((c) => [c.name]),
        ...(target.indexes ?? []).filter((i) => i.unique).map((i) => i.columns),
      ];
      if (!candidates.some((c) => c.length === away.length && c.every((v, i) => v === away[i])))
        fail("SCHEMA", "Foreign key must reference a primary or unique key in declared order");
      if (
        (fk.onDelete && !["CASCADE", "SET NULL", "NO ACTION", "RESTRICT"].includes(fk.onDelete)) ||
        (fk.onUpdate && !["CASCADE", "NO ACTION", "RESTRICT"].includes(fk.onUpdate))
      )
        fail("SCHEMA", "Unknown referential action");
      if (
        fk.onDelete === "SET NULL" &&
        local.some(
          (n) => table.columns.find((c) => c.name === n)!.notNull || primaryKey(table).includes(n),
        )
      )
        fail("SCHEMA", "SET NULL requires nullable non-primary-key columns");
    }
}

function assertKey(table: Table, names: string[]): void {
  if (!names.length || new Set(names).size !== names.length)
    fail("SCHEMA", "Invalid key column list");
  for (const n of names) {
    const c = table.columns.find((c) => c.name === n);
    if (!c || c.type === "jsonb") fail("SCHEMA", `Invalid key column: ${n}`);
  }
}
export function validateValue(column: Column, value: unknown, pk = false): void {
  if (value === null) {
    if (column.notNull || pk) fail("NOT_NULL", `Column ${column.name} cannot be null`);
    return;
  }
  assertJson(value);
  if (!validateType(column.type, value as Row[string]))
    fail("TYPE", `Invalid ${column.type} in ${column.name}`);
}
export function normalize(table: Table, input: Row, defaults: boolean): Row {
  assertJson(input);
  if (Array.isArray(input) || !input || typeof input !== "object")
    fail("TYPE", "Row must be an object");
  for (const n of Object.keys(input))
    if (!table.columns.some((c) => c.name === n)) fail("COLUMN", `Unknown column: ${n}`);
  const row: Row = {};
  for (const c of table.columns) {
    const v = Object.hasOwn(input, c.name)
      ? input[c.name]
      : defaults && "default" in c
        ? clone(c.default!)
        : null;
    validateValue(c, v, primaryKey(table).includes(c.name));
    Object.defineProperty(row, c.name, {
      value: v,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return clone(row);
}

export function assertState(state: State): void {
  assertSchema(state.schema);
  if (
    state.format !== 1 ||
    ![state.revision, state.version, state.nextId].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    state.nextId < 1
  )
    fail("CORRUPT", "Invalid database header");
  if (
    Object.keys(state.rows).length !== state.schema.length ||
    state.schema.some((t) => !Object.hasOwn(state.rows, t.name))
  )
    fail("CORRUPT", "Table catalog and data differ");
  const ids = new Set<number>();
  for (const t of state.schema) {
    const rows = state.rows[t.name];
    if (!Array.isArray(rows)) fail("CORRUPT", "Invalid table data");
    for (const r of rows) {
      if (!Number.isSafeInteger(r.id) || r.id < 1 || r.id >= state.nextId || ids.has(r.id))
        fail("CORRUPT", "Invalid row identity");
      ids.add(r.id);
      if (Object.keys(r.value).length !== t.columns.length)
        fail("CORRUPT", "Stored row is missing columns");
      normalize(t, r.value, false);
      for (const check of t.checks ?? [])
        if (evaluate(check, r.value) === false) fail("CHECK", `Check failed in ${t.name}`);
    }
    const constraints = [
      { columns: primaryKey(t), nullable: false },
      ...t.columns.filter((c) => c.unique).map((c) => ({ columns: [c.name], nullable: true })),
      ...(t.indexes ?? [])
        .filter((i) => i.unique)
        .map((i) => ({ columns: i.columns, nullable: true })),
    ].filter((c) => c.columns.length);
    for (const c of constraints) {
      const seen = new Set<string>();
      for (const r of rows) {
        const values = c.columns.map((n) => r.value[n]);
        if (c.nullable && values.includes(null)) continue;
        const k = key(values);
        if (seen.has(k)) fail("UNIQUE", `Duplicate key in ${t.name}(${c.columns.join(",")})`);
        seen.add(k);
      }
    }
  }
  for (const t of state.schema)
    for (const fk of t.references ?? []) {
      const parents = new Set(
        state.rows[fk.targetTable].map((r) => key(fk.pairs.map((p) => r.value[p.away]))),
      );
      for (const r of state.rows[t.name]) {
        const values = fk.pairs.map((p) => r.value[p.local]);
        if (!values.includes(null) && !parents.has(key(values)))
          fail("FOREIGN_KEY", `Missing ${fk.targetTable} parent for ${t.name}`);
      }
    }
}
