import type { Data, Row } from "../types/types.js";
import { condition, evaluate, validateCondition, type Where } from "./conditions.js";
import { clone, compare, key } from "./value.js";
import { fail } from "./errors.js";

export type Order = { column: string; direction?: "asc" | "desc"; nulls?: "first" | "last" };
export type Aggregate = {
  fn: "count" | "sum" | "avg" | "min" | "max";
  column?: string;
  distinct?: boolean;
};
export type JoinType = "inner" | "left" | "right" | "full";
export type Joined<L extends Row, R extends Row, A extends string> = {
  [K in keyof L]: L[K] | null;
} & { [K in keyof R as `${A}.${K & string}`]: R[K] | null };

/** An immutable, materialized query snapshot. Every result is detached from the database. */
export class Query<R extends Row = Row> implements Iterable<R> {
  private readonly rows: R[];
  readonly columns: readonly string[];
  constructor(rows: R[], columns: readonly string[]) {
    this.rows = clone(rows);
    this.columns = Object.freeze([...columns]);
  }
  all(): R[] {
    return clone(this.rows);
  }
  first(): R | undefined {
    return this.rows.length ? clone(this.rows[0]) : undefined;
  }
  count(): number {
    return this.rows.length;
  }
  [Symbol.iterator](): Iterator<R> {
    return this.all()[Symbol.iterator]();
  }
  private requireColumn(name: string): void {
    if (!this.columns.includes(name)) fail("COLUMN", `Unknown query column: ${name}`);
  }
  where(where: Where | ((row: R) => boolean)): Query<R> {
    if (typeof where === "function")
      return new Query(
        this.rows.filter((r) => where(clone(r))),
        this.columns,
      );
    const c = condition(where)!;
    validateCondition(c, [...this.columns]);
    return new Query(
      this.rows.filter((r) => evaluate(c, r) === true),
      this.columns,
    );
  }
  select<K extends keyof R & string>(...columns: K[]): Query<Pick<R, K>> {
    if (!columns.length || new Set(columns).size !== columns.length)
      fail("QUERY", "Projection needs distinct columns");
    columns.forEach((c) => this.requireColumn(c));
    return new Query(
      this.rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])) as Pick<R, K>),
      columns,
    );
  }
  orderBy(...orders: (Order | (keyof R & string))[]): Query<R> {
    const list: Order[] = orders.map((o) => (typeof o === "string" ? { column: o } : o));
    list.forEach((o) => {
      this.requireColumn(o.column);
      if (
        (o.direction && !["asc", "desc"].includes(o.direction)) ||
        (o.nulls && !["first", "last"].includes(o.nulls))
      )
        fail("QUERY", "Invalid ordering");
    });
    return new Query(
      [...this.rows].sort((a, b) => {
        for (const o of list) {
          const x = a[o.column],
            y = b[o.column];
          const cmp =
            x === null || y === null
              ? x === y
                ? 0
                : (x === null ? 1 : -1) * (o.nulls === "first" ? -1 : 1)
              : compare(x, y) * (o.direction === "desc" ? -1 : 1);
          if (cmp) return cmp;
        }
        return 0;
      }),
      this.columns,
    );
  }
  limit(limit: number, offset = 0): Query<R> {
    if (![limit, offset].every((n) => Number.isSafeInteger(n) && n >= 0))
      fail("QUERY", "Limit and offset must be non-negative integers");
    return new Query(this.rows.slice(offset, offset + limit), this.columns);
  }
  distinct(): Query<R> {
    const seen = new Set<string>();
    return new Query(
      this.rows.filter((r) => {
        const k = key(r);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
      this.columns,
    );
  }
  union(other: Query<R>, all = false): Query<R> {
    this.compatible(other);
    const result = new Query([...this.rows, ...other.rows], this.columns);
    return all ? result : result.distinct();
  }
  intersect(other: Query<R>): Query<R> {
    this.compatible(other);
    const keys = new Set(other.rows.map(key));
    return new Query(
      this.rows.filter((r) => keys.has(key(r))),
      this.columns,
    ).distinct();
  }
  except(other: Query<R>): Query<R> {
    this.compatible(other);
    const keys = new Set(other.rows.map(key));
    return new Query(
      this.rows.filter((r) => !keys.has(key(r))),
      this.columns,
    ).distinct();
  }
  private compatible(other: Query<R>): void {
    if (key([...this.columns].sort()) !== key([...other.columns].sort()))
      fail("QUERY", "Set operations need the same named columns");
  }
  join<U extends Row, A extends string>(
    other: Query<U>,
    options: {
      on: [keyof R & string, keyof U & string][];
      alias: A;
      type?: JoinType;
    },
  ): Query<Joined<R, U, A>> {
    const kind = options.type ?? "inner";
    if (!["inner", "left", "right", "full"].includes(kind) || !options.on.length)
      fail("QUERY", "Invalid join");
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(options.alias)) fail("QUERY", "Invalid join alias");
    options.on.forEach(([l, r]) => {
      this.requireColumn(l);
      other.requireColumn(r);
    });
    const rightColumns = other.columns.map((c) => `${options.alias}.${c}`);
    if (rightColumns.some((c) => this.columns.includes(c)))
      fail("QUERY", "Join alias conflicts with existing columns");
    const result: Row[] = [],
      matched = new Set<number>(),
      buckets = new Map<string, number[]>();
    other.rows.forEach((r, i) => {
      const values: Data[] = options.on.map(([, k]) => r[k]);
      if (values.includes(null)) return;
      const k = key(values),
        bucket = buckets.get(k) ?? [];
      bucket.push(i);
      buckets.set(k, bucket);
    });
    const output = (left: R | undefined, right: U | undefined): Row =>
      Object.fromEntries([
        ...this.columns.map((c) => [c, left ? left[c] : null]),
        ...other.columns.map((c) => [`${options.alias}.${c}`, right ? right[c] : null]),
      ]);
    for (const l of this.rows) {
      const values: Data[] = options.on.map(([k]) => l[k]);
      const hits = values.includes(null) ? [] : (buckets.get(key(values)) ?? []);
      for (const i of hits) {
        matched.add(i);
        result.push(output(l, other.rows[i]));
      }
      if (!hits.length && (kind === "left" || kind === "full")) result.push(output(l, undefined));
    }
    if (kind === "right" || kind === "full")
      other.rows.forEach((r, i) => {
        if (!matched.has(i)) result.push(output(undefined, r));
      });
    return new Query(result as Joined<R, U, A>[], [...this.columns, ...rightColumns]);
  }
  aggregate(aggregates: Record<string, Aggregate>, groupBy: (keyof R & string)[] = []): Query<Row> {
    if (!Object.keys(aggregates).length || new Set(groupBy).size !== groupBy.length)
      fail("QUERY", "Invalid aggregation");
    groupBy.forEach((c) => this.requireColumn(c));
    for (const [name, a] of Object.entries(aggregates)) {
      if (groupBy.includes(name) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
        fail("QUERY", "Invalid aggregate alias");
      if (!["count", "sum", "avg", "min", "max"].includes(a.fn)) fail("QUERY", "Unknown aggregate");
      if (!a.column || a.column === "*") {
        if (a.fn !== "count" || a.distinct)
          fail("QUERY", "Only count permits *; distinct count requires a column");
      } else this.requireColumn(a.column);
    }
    const groups = new Map<string, R[]>();
    if (!groupBy.length) groups.set("[]", []);
    for (const r of this.rows) {
      const k = key(groupBy.map((c) => r[c])),
        group = groups.get(k) ?? [];
      group.push(r);
      groups.set(k, group);
    }
    const result = [...groups.values()].map((rows) => {
      const row: Row = Object.fromEntries(groupBy.map((c) => [c, rows[0][c]]));
      for (const [name, a] of Object.entries(aggregates)) {
        let values: Data[] =
          a.column && a.column !== "*"
            ? rows.map((r) => r[a.column!]).filter((v) => v !== null)
            : rows.map(() => 1);
        if (a.distinct) values = [...new Map(values.map((v) => [key(v), v])).values()];
        if (a.fn === "count") row[name] = values.length;
        else if (!values.length) row[name] = null;
        else if (a.fn === "sum" || a.fn === "avg") {
          if (values.some((v) => typeof v !== "number"))
            fail("TYPE", "Sum and average require numbers");
          const sum = (values as number[]).reduce((n, v) => n + v, 0);
          if (!Number.isFinite(sum)) fail("TYPE", "Aggregate overflow");
          row[name] = a.fn === "avg" ? sum / values.length : sum;
        } else
          row[name] = values.reduce((best, v) =>
            compare(v, best) * (a.fn === "min" ? 1 : -1) < 0 ? v : best,
          );
      }
      return row;
    });
    return new Query(result, [...groupBy, ...Object.keys(aggregates)]);
  }
}
