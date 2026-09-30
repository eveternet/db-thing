import type {
  Alter_Shenanigans,
  Data,
  Database_Operation,
  IndexDefinition,
  InferRow,
  Row,
  Table,
} from "../types/types.js";
import {
  assertName,
  assertSchema,
  assertState,
  normalize,
  primaryKey,
  validateValue,
  type State,
  type StoredRow,
} from "./catalog.js";
import { condition, evaluate, validateCondition, type Where } from "./conditions.js";
import { DatabaseError, fail } from "./errors.js";
import { Query } from "./query.js";
import { Storage } from "./storage.js";
import { assertJson, clone, key } from "./value.js";

type Index = { name: string; columns: string[]; entries: Map<string, Set<number>> };
export type QueryPlan = {
  table: string;
  access: "scan" | "index";
  index?: string;
  candidates: number;
  totalRows: number;
};
export type DatabaseOptions<S extends readonly Table[]> = {
  directory?: string;
  schema?: S;
  version?: number;
};
export type Migration = { version: number; up: (db: Database) => unknown };
type TableRow<S extends readonly Table[], N extends string> = InferRow<
  Extract<S[number], { name: N }> extends never ? Table : Extract<S[number], { name: N }>
>;
type Change = { table: string; id: number; before: Row; after?: Row };

/** A synchronous embedded RDBMS. File-backed databases hold an exclusive process lock. */
export class Database<const S extends readonly Table[] = Table[]> {
  private state: State;
  private storage?: Storage;
  private closed = false;
  private busy = false;
  private scoped = false;
  private indexes = new Map<string, Index[]>();
  private rowMaps = new Map<string, Map<number, StoredRow>>();
  constructor(options: DatabaseOptions<S> = {}) {
    try {
      if (options.schema !== undefined) assertSchema(options.schema);
      if (
        options.version !== undefined &&
        (!Number.isSafeInteger(options.version) || options.version < 0)
      )
        fail("SCHEMA", "Version must be a non-negative integer");
      if (options.directory !== undefined) {
        if (typeof options.directory !== "string" || !options.directory.length)
          fail("STORAGE", "Directory must be a non-empty path");
        this.storage = new Storage(options.directory);
      }
      const recovered = this.storage?.load();
      this.state = recovered ?? {
        format: 1,
        revision: 0,
        version: options.version ?? 0,
        nextId: 1,
        schema: clone(options.schema ?? []) as Table[],
        rows: {},
      };
      if (!recovered) for (const t of this.state.schema) this.state.rows[t.name] = [];
      try {
        assertState(this.state);
      } catch (e) {
        if (recovered)
          throw new DatabaseError(
            "CORRUPT",
            "Recovered database violates its schema or integrity constraints",
            { cause: e },
          );
        throw e;
      }
      if (recovered && options.schema && key(options.schema) !== key(recovered.schema))
        fail("SCHEMA", "Stored schema differs; open without schema and apply a migration");
      if (recovered && options.version !== undefined && options.version !== recovered.version)
        fail("SCHEMA", "Stored schema version differs");
      this.rebuild();
      if (!recovered) this.storage?.save(this.state);
    } catch (e) {
      this.storage?.close();
      throw e;
    }
  }
  private ready(): void {
    if (this.closed || this.storage?.poisoned)
      fail("CLOSED", "Database is closed or requires recovery");
    if (this.busy) fail("TRANSACTION", "Use the supplied transaction handle inside the callback");
  }
  get schema(): Table[] {
    this.ready();
    return clone(this.state.schema);
  }
  get version(): number {
    this.ready();
    return this.state.version;
  }
  get revision(): number {
    this.ready();
    return this.state.revision;
  }
  private definition(name: string): Table {
    this.ready();
    const table = this.state.schema.find((t) => t.name === name);
    if (!table) fail("TABLE", `Unknown table: ${name}`);
    return table;
  }
  table<N extends S[number]["name"]>(name: N): TableHandle<TableRow<S, N>> {
    this.definition(name);
    return new TableHandle(this, name) as TableHandle<TableRow<S, N>>;
  }
  private rebuild(): void {
    const derived = this.buildDerived(this.state);
    this.indexes = derived.indexes;
    this.rowMaps = derived.rowMaps;
  }
  private buildDerived(state: State): {
    indexes: Map<string, Index[]>;
    rowMaps: Map<string, Map<number, StoredRow>>;
  } {
    const indexes = new Map<string, Index[]>(),
      rowMaps = new Map<string, Map<number, StoredRow>>();
    for (const t of state.schema) {
      rowMaps.set(t.name, new Map(state.rows[t.name].map((r) => [r.id, r])));
      const definitions = [
        ...(primaryKey(t).length ? [{ name: "$primary", columns: primaryKey(t) }] : []),
        ...t.columns
          .filter((c) => c.unique)
          .map((c) => ({ name: `$unique_${c.name}`, columns: [c.name] })),
        ...(t.indexes ?? []),
      ];
      indexes.set(
        t.name,
        definitions.map((d) => {
          const entries = new Map<string, Set<number>>();
          for (const r of state.rows[t.name]) {
            const k = key(d.columns.map((c) => r.value[c])),
              ids = entries.get(k) ?? new Set<number>();
            ids.add(r.id);
            entries.set(k, ids);
          }
          return { ...d, entries };
        }),
      );
    }
    return { indexes, rowMaps };
  }
  private mutate<T>(fn: (state: State) => T): T {
    this.ready();
    const draft = clone(this.state);
    const result = fn(draft);
    assertState(draft);
    draft.revision++;
    if (!Number.isSafeInteger(draft.revision)) fail("STORAGE", "Revision overflow");
    const detached = clone(result),
      derived = this.buildDerived(draft);
    this.storage?.save(draft);
    this.state = draft;
    this.indexes = derived.indexes;
    this.rowMaps = derived.rowMaps;
    return detached;
  }
  private find(name: string, where?: Where): { rows: StoredRow[]; plan: QueryPlan } {
    const t = this.definition(name),
      c = condition(where);
    validateCondition(
      c,
      t.columns.map((c) => c.name),
    );
    const equality = new Map<string, Data>();
    const collect = (n: NonNullable<typeof c>): void => {
      if (n.type === "logical" && n.operator === "AND") n.operands.forEach(collect);
      else if (
        n.type === "comparison" &&
        n.operator === "=" &&
        n.value !== null &&
        n.value !== undefined
      )
        equality.set(n.column, n.value);
      else if (n.type === "comparison" && n.operator === "IS NULL") equality.set(n.column, null);
    };
    if (c) collect(c);
    const rows = this.state.rows[name];
    const usable = (this.indexes.get(name) ?? []).filter((i) =>
      i.columns.every((c) => equality.has(c)),
    );
    let best: { index: Index; ids: Set<number> } | undefined;
    for (const index of usable) {
      const ids =
        index.entries.get(key(index.columns.map((c) => equality.get(c)))) ?? new Set<number>();
      if (!best || ids.size < best.ids.size) best = { index, ids };
    }
    const candidates = best
      ? [...best.ids].sort((a, b) => a - b).map((id) => this.rowMaps.get(name)!.get(id)!)
      : rows;
    return {
      rows: candidates.filter((r) => !c || evaluate(c, r.value) === true),
      plan: {
        table: name,
        access: best ? "index" : "scan",
        ...(best ? { index: best.index.name } : {}),
        candidates: candidates.length,
        totalRows: rows.length,
      },
    };
  }
  explain(name: string, where?: Where): QueryPlan {
    return this.find(name, where).plan;
  }
  query(name: string, where?: Where): Query<Row> {
    const rows = this.find(name, where).rows;
    return new Query(
      clone(rows.map((r) => r.value)),
      this.definition(name).columns.map((c) => c.name),
    );
  }
  insert(name: string, input: Row | Row[]): Row[] {
    assertJson(input);
    const t = this.definition(name),
      data = clone(Array.isArray(input) ? input : [input]);
    return this.mutate((state) => {
      const values = data.map((r) => normalize(t, r, true));
      for (const value of values) {
        if (!Number.isSafeInteger(state.nextId + 1)) fail("STORAGE", "Row identity overflow");
        state.rows[name].push({ id: state.nextId++, value });
      }
      return values;
    });
  }
  update(name: string, patch: Row, where?: Where): number {
    const t = this.definition(name);
    assertJson(patch);
    if (!patch || Array.isArray(patch) || typeof patch !== "object")
      fail("TYPE", "Update patch must be an object");
    for (const name of Object.keys(patch)) {
      const c = t.columns.find((col) => col.name === name);
      if (!c) fail("COLUMN", `Unknown column: ${name}`);
      validateValue(c, patch[name], primaryKey(t).includes(name));
    }
    const selected = new Set(this.find(name, where).rows.map((r) => r.id)),
      detached = clone(patch);
    return this.mutate((state) => {
      const changes: Change[] = [];
      for (const r of state.rows[name])
        if (selected.has(r.id)) {
          const before = clone(r.value);
          r.value = normalize(t, { ...r.value, ...detached }, false);
          changes.push({ table: name, id: r.id, before, after: clone(r.value) });
        }
      this.cascade(state, changes);
      return selected.size;
    });
  }
  delete(name: string, where?: Where): number {
    const selected = new Set(this.find(name, where).rows.map((r) => r.id));
    return this.mutate((state) => {
      const changes: Change[] = state.rows[name]
        .filter((r) => selected.has(r.id))
        .map((r) => ({ table: name, id: r.id, before: clone(r.value) }));
      state.rows[name] = state.rows[name].filter((r) => !selected.has(r.id));
      this.cascade(state, changes);
      return selected.size;
    });
  }
  private cascade(state: State, changes: Change[]): void {
    const visited = new Set<string>();
    for (let i = 0; i < changes.length; i++) {
      if (i > 100000) fail("FOREIGN_KEY", "Referential action did not converge");
      const change = changes[i],
        signature = key(change);
      if (visited.has(signature)) continue;
      visited.add(signature);
      for (const t of state.schema)
        for (const fk of t.references ?? []) {
          if (fk.targetTable !== change.table) continue;
          const oldValues = fk.pairs.map((p) => change.before[p.away]);
          if (oldValues.includes(null)) continue;
          const newValues = change.after ? fk.pairs.map((p) => change.after![p.away]) : undefined;
          if (newValues && key(newValues) === key(oldValues)) continue;
          const children = state.rows[t.name].filter(
            (r) => key(fk.pairs.map((p) => r.value[p.local])) === key(oldValues),
          );
          const action = change.after ? (fk.onUpdate ?? "NO ACTION") : (fk.onDelete ?? "NO ACTION");
          if (action === "RESTRICT" && children.length)
            fail("FOREIGN_KEY", `Restricted change of ${change.table}`);
          if (action === "NO ACTION") continue;
          for (const child of children) {
            const before = clone(child.value);
            if (!change.after && action === "CASCADE") {
              state.rows[t.name] = state.rows[t.name].filter((r) => r.id !== child.id);
              changes.push({ table: t.name, id: child.id, before });
            } else {
              fk.pairs.forEach((p, j) => {
                child.value[p.local] = action === "SET NULL" ? null : newValues![j];
              });
              changes.push({ table: t.name, id: child.id, before, after: clone(child.value) });
            }
          }
        }
    }
  }
  createTable(table: Table): void {
    assertJson(table);
    const def = clone(table);
    this.mutate((s) => {
      if (s.schema.some((t) => t.name === def.name)) fail("TABLE", `Table exists: ${def.name}`);
      s.schema.push(def);
      assertSchema(s.schema);
      s.rows[def.name] = [];
    });
  }
  dropTable(name: string): void {
    this.definition(name);
    this.mutate((s) => {
      if (
        s.schema.some((t) => t.name !== name && t.references?.some((fk) => fk.targetTable === name))
      )
        fail("FOREIGN_KEY", "Table is referenced by another table");
      s.schema = s.schema.filter((t) => t.name !== name);
      delete s.rows[name];
    });
  }
  createIndex(table: string, index: IndexDefinition): void {
    assertJson(index);
    this.definition(table);
    const def = clone(index);
    this.mutate((s) => {
      const t = s.schema.find((t) => t.name === table)!;
      (t.indexes ??= []).push(def);
    });
  }
  dropIndex(table: string, name: string): void {
    this.definition(table);
    this.mutate((s) => {
      const t = s.schema.find((t) => t.name === table)!;
      if (!t.indexes?.some((i) => i.name === name)) fail("SCHEMA", `Unknown index: ${name}`);
      t.indexes = t.indexes.filter((i) => i.name !== name);
    });
  }
  alterTable(name: string, alteration: Alter_Shenanigans): void {
    assertJson(alteration);
    this.definition(name);
    const a = clone(alteration);
    this.mutate((s) => {
      const t = s.schema.find((t) => t.name === name)!;
      if (a.operation === "ADD COLUMN") {
        t.columns.push(a.data);
        for (const r of s.rows[name]) r.value = normalize(t, r.value, true);
      } else {
        const c = t.columns.find((c) => c.name === a.name);
        if (!c) fail("COLUMN", `Unknown column: ${a.name}`);
        if (a.operation === "DROP COLUMN") {
          if (
            primaryKey(t).includes(a.name) ||
            t.indexes?.some((i) => i.columns.includes(a.name)) ||
            s.schema.some((tbl) =>
              tbl.references?.some(
                (fk) =>
                  (tbl.name === name && fk.pairs.some((p) => p.local === a.name)) ||
                  (fk.targetTable === name && fk.pairs.some((p) => p.away === a.name)),
              ),
            )
          )
            fail("SCHEMA", "Column is used by a key, index, or reference");
          t.columns = t.columns.filter((c) => c.name !== a.name);
          for (const r of s.rows[name]) delete r.value[a.name];
        } else if (a.operation === "RENAME COLUMN") {
          assertName(a.newname);
          c.name = a.newname;
          for (const r of s.rows[name]) {
            r.value[a.newname] = r.value[a.name];
            delete r.value[a.name];
          }
          if (t.pk)
            t.pk =
              typeof t.pk === "string"
                ? t.pk === a.name
                  ? a.newname
                  : t.pk
                : t.pk.map((n) => (n === a.name ? a.newname : n));
          for (const idx of t.indexes ?? [])
            idx.columns = idx.columns.map((n) => (n === a.name ? a.newname : n));
          const renameCheck = (node: NonNullable<Table["checks"]>[number]): void => {
            if (node.type === "logical") node.operands.forEach(renameCheck);
            else if (node.column === a.name) node.column = a.newname;
          };
          (t.checks ?? []).forEach(renameCheck);
          for (const tbl of s.schema)
            for (const fk of tbl.references ?? [])
              for (const p of fk.pairs) {
                if (tbl.name === name && p.local === a.name) p.local = a.newname;
                if (fk.targetTable === name && p.away === a.name) p.away = a.newname;
              }
        } else {
          c.type = a.type;
          if ("default" in a && a.default !== undefined) c.default = a.default;
        }
      }
    });
  }
  transaction<T>(fn: (tx: Database<S>) => T): T {
    this.ready();
    const tx = new Database<S>();
    tx.state = clone(this.state);
    tx.scoped = true;
    tx.rebuild();
    this.busy = true;
    try {
      const result = fn(tx);
      if (result && typeof (result as { then?: unknown }).then === "function") {
        Promise.resolve(result).catch(() => {});
        fail("TRANSACTION", "Transactions must be synchronous");
      }
      assertState(tx.state);
      tx.state.revision = this.state.revision + 1;
      if (!Number.isSafeInteger(tx.state.revision)) fail("STORAGE", "Revision overflow");
      const draft = clone(tx.state),
        derived = this.buildDerived(draft);
      this.storage?.save(draft);
      this.state = draft;
      this.indexes = derived.indexes;
      this.rowMaps = derived.rowMaps;
      return result;
    } finally {
      tx.closed = true;
      this.busy = false;
    }
  }
  migrate(migrations: Migration[]): void {
    this.ready();
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    if (
      new Set(sorted.map((m) => m.version)).size !== sorted.length ||
      sorted.some((m) => !Number.isSafeInteger(m.version) || m.version < 1)
    )
      fail("SCHEMA", "Migration versions must be unique positive integers");
    if (sorted.every((m) => m.version <= this.state.version)) return;
    this.transaction((tx) => {
      for (const migration of sorted)
        if (migration.version > tx.state.version) {
          if (migration.version !== tx.state.version + 1)
            fail("SCHEMA", "Migration versions must be contiguous");
          const result = migration.up(tx as unknown as Database);
          if (result && typeof (result as { then?: unknown }).then === "function") {
            Promise.resolve(result).catch(() => {});
            fail("TRANSACTION", "Migrations must be synchronous");
          }
          tx.state.version = migration.version;
        }
    });
  }
  execute(op: Database_Operation): Row[] | number | void {
    this.ready();
    switch (op.operation) {
      case "SELECT": {
        let q = this.query(op.table, op.conditions);
        if (op.orderBy) q = q.orderBy(...op.orderBy);
        if (op.columns.length !== 1 || op.columns[0] !== "*") q = q.select(...op.columns);
        if (op.distinct) q = q.distinct();
        if (op.limit !== undefined || op.offset !== undefined)
          q = q.limit(op.limit ?? Number.MAX_SAFE_INTEGER, op.offset ?? 0);
        return q.all();
      }
      case "INSERT":
        return this.insert(op.table, op.data as Row);
      case "UPDATE": {
        if (new Set(op.modify.map((p) => p.column)).size !== op.modify.length)
          fail("QUERY", "Duplicate update columns");
        return this.update(
          op.table,
          Object.fromEntries(op.modify.map((p) => [p.column, p.value])),
          op.conditions,
        );
      }
      case "DELETE":
        return this.delete(op.table, op.conditions);
      case "CREATE TABLE":
        return this.createTable(op.data);
      case "DROP TABLE":
        return this.dropTable(op.name);
      case "ALTER TABLE":
        return this.alterTable(op.name, op.modifications);
      default:
        fail("QUERY", "Unknown operation");
    }
  }
  executeBatch(operations: Database_Operation[]): (Row[] | number | void)[] {
    return this.transaction((tx) => operations.map((op) => tx.execute(op)));
  }
  integrityCheck(): true {
    this.ready();
    assertState(this.state);
    for (const t of this.state.schema) {
      const rows = this.state.rows[t.name],
        map = this.rowMaps.get(t.name)!;
      if (map.size !== rows.length || rows.some((r) => key(map.get(r.id)) !== key(r)))
        fail("CORRUPT", `Row map mismatch in ${t.name}`);
      for (const index of this.indexes.get(t.name) ?? []) {
        for (const r of rows)
          if (!index.entries.get(key(index.columns.map((c) => r.value[c])))?.has(r.id))
            fail("CORRUPT", `Missing index entry: ${index.name}`);
        for (const [k, ids] of index.entries)
          for (const id of ids) {
            const r = map.get(id);
            if (!r || key(index.columns.map((c) => r.value[c])) !== k)
              fail("CORRUPT", `Stale index entry: ${index.name}`);
          }
      }
    }
    return true;
  }
  checkpoint(): void {
    this.ready();
    const indexes = Object.fromEntries(
      [...this.indexes].map(([name, list]) => [
        name,
        list.map((i) => ({
          name: i.name,
          columns: i.columns,
          entries: Object.fromEntries([...i.entries].map(([k, ids]) => [k, [...ids]])),
        })),
      ]),
    );
    try {
      this.storage?.checkpoint(this.state, indexes);
    } catch (e) {
      throw new DatabaseError("STORAGE", "Checkpoint failed; committed journal is intact", {
        cause: e,
      });
    }
  }
  close(): void {
    if (this.closed) return;
    if (this.busy || this.scoped)
      fail("TRANSACTION", "Cannot close a transaction handle or close during a transaction");
    this.storage?.close();
    this.closed = true;
  }
}
export class TableHandle<R extends Row = Row> implements Iterable<R> {
  constructor(
    private db: Pick<Database, "query" | "insert" | "update" | "delete" | "explain">,
    readonly name: string,
  ) {}
  query(where?: Where): Query<R> {
    return this.db.query(this.name, where) as Query<R>;
  }
  all(): R[] {
    return this.query().all();
  }
  filter(where: Where): R[] {
    return this.query(where).all();
  }
  insert(input: Partial<R> | Partial<R>[]): R[] {
    return this.db.insert(this.name, input as Row | Row[]) as R[];
  }
  update(patch: Partial<R>, where?: Where): number {
    return this.db.update(this.name, patch as Row, where);
  }
  delete(where?: Where): number {
    return this.db.delete(this.name, where);
  }
  count(where?: Where): number {
    return this.query(where).count();
  }
  explain(where?: Where): QueryPlan {
    return this.db.explain(this.name, where);
  }
  [Symbol.iterator](): Iterator<R> {
    return this.all()[Symbol.iterator]();
  }
}
export { Database as dbms };
