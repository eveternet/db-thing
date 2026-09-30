import { expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import {
  Database,
  eq,
  ne,
  lt,
  gt,
  lte,
  gte,
  and,
  or,
  not,
  between,
  inList,
  isNull,
  like,
  type ConditionNode,
  type Table,
  type Row,
} from "../src/index.js";

function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const schema: Table[] = [
  {
    name: "items",
    pk: "id",
    columns: [
      { name: "id", type: "number" },
      { name: "score", type: "number" },
      { name: "tag", type: "text" },
    ],
    indexes: [{ name: "score_index", columns: ["score"] }],
  },
];

test("500 generated predicates agree with SQLite, including three-valued NULL logic", () => {
  const db = new Database({ schema }),
    sql = new SQLite(":memory:"),
    rng = random(42);
  try {
    sql.exec(
      "CREATE TABLE items(id INTEGER PRIMARY KEY, score REAL, tag TEXT); PRAGMA case_sensitive_like=ON;",
    );
    const insert = sql.prepare("INSERT INTO items VALUES (?, ?, ?)");
    const rows = Array.from({ length: 60 }, (_, id) => ({
      id,
      score: rng() < 0.3 ? null : Math.floor(rng() * 20) - 10,
      tag: ["Evie", "Axo", "é", "😀", "x\n", "a.b", null][Math.floor(rng() * 7)],
    }));
    db.insert("items", rows);
    for (const row of rows) insert.run(row.id, row.score, row.tag);
    function expression(depth: number): {
      node: ConditionNode;
      text: string;
      args: (string | number | null)[];
    } {
      if (depth > 0 && rng() < 0.5) {
        const a = expression(depth - 1);
        if (rng() < 0.3) return { node: not(a.node), text: `NOT (${a.text})`, args: a.args };
        const b = expression(depth - 1),
          both = rng() < 0.5;
        return {
          node: both ? and(a.node, b.node) : or(a.node, b.node),
          text: `(${a.text}) ${both ? "AND" : "OR"} (${b.text})`,
          args: [...a.args, ...b.args],
        };
      }
      const n = Math.floor(rng() * 20) - 10,
        kind = Math.floor(rng() * 10);
      const comparisons = [
        [eq, "="],
        [ne, "!="],
        [lt, "<"],
        [gt, ">"],
        [lte, "<="],
        [gte, ">="],
      ] as const;
      if (kind < 6) {
        const [fn, op] = comparisons[kind],
          val = rng() < 0.2 ? null : n;
        return { node: fn("score", val), text: `score ${op} ?`, args: [val] };
      }
      if (kind === 6)
        return {
          node: between("score", n, n + 5),
          text: "score BETWEEN ? AND ?",
          args: [n, n + 5],
        };
      if (kind === 7)
        return {
          node: inList("score", [n, null, n + 1]),
          text: "score IN (?, ?, ?)",
          args: [n, null, n + 1],
        };
      if (kind === 8) return { node: isNull("score"), text: "score IS NULL", args: [] };
      const pattern = ["E%", "_", "%", "x", "a.b"][Math.floor(rng() * 5)];
      return { node: like("tag", pattern), text: "tag LIKE ?", args: [pattern] };
    }
    for (let i = 0; i < 500; i++) {
      const e = expression(3),
        actual = db.query("items", e.node).orderBy("id").select("id").all();
      const expected = sql.query(`SELECT id FROM items WHERE ${e.text} ORDER BY id`).all(...e.args);
      expect<unknown>(actual).toEqual(expected);
    }
    expect<unknown>(
      db
        .query("items")
        .aggregate(
          {
            n: { fn: "count" },
            s: { fn: "sum", column: "score" },
            a: { fn: "avg", column: "score" },
            low: { fn: "min", column: "score" },
            high: { fn: "max", column: "score" },
          },
          ["tag"],
        )
        .orderBy({ column: "tag", nulls: "first" })
        .all(),
    ).toEqual(
      sql
        .query(
          "SELECT tag, COUNT(*) n, SUM(score) s, AVG(score) a, MIN(score) low, MAX(score) high FROM items GROUP BY tag ORDER BY tag",
        )
        .all(),
    );
  } finally {
    db.close();
    sql.close();
  }
});

test("300 seeded mutations preserve indexed/scan results and agree with SQLite", () => {
  const db = new Database({ schema }),
    sql = new SQLite(":memory:"),
    rng = random(314),
    model = new Map<number, Row>();
  try {
    sql.exec("CREATE TABLE items(id INTEGER PRIMARY KEY, score REAL, tag TEXT)");
    for (let i = 0; i < 300; i++) {
      const id = Math.floor(rng() * 35),
        score = rng() < 0.2 ? null : Math.floor(rng() * 10),
        tag = `tag${Math.floor(rng() * 4)}`;
      if (rng() < 0.3) {
        db.delete("items", { id });
        sql.query("DELETE FROM items WHERE id = ?").run(id);
        model.delete(id);
      } else if (model.has(id)) {
        db.update("items", { score, tag }, { id });
        sql.query("UPDATE items SET score=?,tag=? WHERE id=?").run(score, tag, id);
        model.set(id, { id, score, tag });
      } else {
        db.insert("items", { id, score, tag });
        sql.query("INSERT INTO items VALUES (?,?,?)").run(id, score, tag);
        model.set(id, { id, score, tag });
      }
      expect<unknown>(db.query("items").orderBy("id").all()).toEqual(
        sql.query("SELECT * FROM items ORDER BY id").all(),
      );
      const where = score === null ? isNull("score") : eq("score", score);
      expect<unknown>(db.query("items", where).orderBy("id").all()).toEqual(
        db.query("items").where(where).orderBy("id").all(),
      );
      expect<unknown>(db.integrityCheck()).toBe(true);
    }
  } finally {
    db.close();
    sql.close();
  }
});

test("joins and grouped aggregates agree with SQLite", () => {
  const db = new Database({ schema }),
    sql = new SQLite(":memory:");
  try {
    db.createTable({
      name: "notes",
      columns: [
        { name: "itemId", type: "number" },
        { name: "value", type: "number" },
      ],
    });
    db.insert("items", [
      { id: 1, score: 1, tag: "a" },
      { id: 2, score: 2, tag: "b" },
      { id: 3, score: null, tag: null },
    ]);
    db.insert("notes", [
      { itemId: 1, value: 10 },
      { itemId: 1, value: 20 },
      { itemId: 2, value: null },
      { itemId: 5, value: 30 },
      { itemId: null, value: 40 },
    ]);
    sql.exec(
      "CREATE TABLE items(id INTEGER, score REAL, tag TEXT); CREATE TABLE notes(itemId INTEGER, value REAL); INSERT INTO items VALUES (1,1,'a'),(2,2,'b'),(3,NULL,NULL); INSERT INTO notes VALUES (1,10),(1,20),(2,NULL),(5,30),(NULL,40);",
    );
    for (const kind of ["inner", "left", "right", "full"] as const) {
      const actual = db
        .query("items")
        .join(db.query("notes"), { alias: "n", on: [["id", "itemId"]], type: kind })
        .select("id", "n.value")
        .orderBy("id", "n.value")
        .all();
      const expected = sql
        .query(
          `SELECT items.id, notes.value AS 'n.value' FROM items ${kind.toUpperCase()} JOIN notes ON items.id=notes.itemId ORDER BY items.id NULLS LAST, notes.value NULLS LAST`,
        )
        .all();
      expect<unknown>(actual).toEqual(expected);
    }
  } finally {
    db.close();
    sql.close();
  }
});
