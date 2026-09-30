import { afterEach, describe, expect, test } from "bun:test";
import {
  Database,
  DatabaseError,
  Schema,
  ORM,
  eq,
  ne,
  gt,
  lt,
  gte,
  lte,
  and,
  or,
  not,
  between,
  inList,
  isNull,
  isNotNull,
  like,
  validateType,
  type Table,
  type ConditionNode,
  type Data,
  type Row,
  type ErrorCode,
} from "../src/index.js";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const resources: Database[] = [],
  folders: string[] = [];
function open(schema: Table[] = usersSchema(), directory?: string): Database {
  const db = new Database({ schema, directory });
  resources.push(db);
  return db;
}
function folder(): string {
  const p = mkdtempSync(join(tmpdir(), "db-thing-"));
  folders.push(p);
  return p;
}
afterEach(() => {
  for (const db of resources.splice(0)) db.close();
  for (const p of folders.splice(0)) rmSync(p, { recursive: true, force: true });
});
function usersSchema(): Table[] {
  return [
    {
      name: "users",
      pk: "id",
      columns: [
        { name: "id", type: "number" },
        { name: "name", type: "text", notNull: true },
        { name: "email", type: "text", unique: true },
        { name: "age", type: "number", default: 18 },
        { name: "profile", type: "jsonb", default: {} },
      ],
      indexes: [{ name: "by_name", columns: ["name"] }],
      checks: [gte("age", 0)],
    },
  ];
}
function code(fn: () => unknown, expected: ErrorCode) {
  try {
    fn();
    throw Error("Expected failure");
  } catch (e) {
    expect(e).toBeInstanceOf(DatabaseError);
    expect((e as DatabaseError).code).toBe(expected);
  }
}
function seed(db: Database) {
  db.insert("users", [
    { id: 1, name: "Evie", age: 18 },
    { id: 2, name: "Axo", age: 20, email: "a@example.com" },
    { id: 3, name: "Evie", age: null },
  ]);
}

describe("CRUD and constraints", () => {
  test("create, batch insert, filter, update, delete and iterate", () => {
    const db = open();
    seed(db);
    const users = db.table("users");
    expect(users.count()).toBe(3);
    expect(users.filter({ name: "Evie" }).length).toBe(2);
    expect(users.update({ name: "Evelyn" }, { id: 1 })).toBe(1);
    expect(users.delete({ id: 2 })).toBe(1);
    expect([...users].map((r) => r.id)).toEqual([1, 3]);
    expect(db.integrityCheck()).toBe(true);
  });
  test("defaults and implicit nullable values", () => {
    const db = open();
    expect(db.insert("users", { id: 1, name: "Evie" })).toEqual([
      { id: 1, name: "Evie", age: 18, email: null, profile: {} },
    ]);
  });
  test("all inputs, results and schema are detached", () => {
    const schema = usersSchema(),
      db = open(schema),
      obj = { nested: [1] };
    const result = db.insert("users", { id: 1, name: "Evie", profile: obj });
    obj.nested.push(2);
    (result[0].profile as { nested: number[] }).nested.push(3);
    schema[0].name = "changed";
    db.schema[0].name = "alsoChanged";
    const q = db.query("users");
    q.all()[0].name = "changed";
    q.where((r) => {
      r.name = "mutated";
      return true;
    });
    expect(q.first()?.name).toBe("Evie");
    expect(db.query("users").first()?.profile).toEqual({ nested: [1] });
  });
  test("batch failures rollback rows and indexes", () => {
    const db = open();
    seed(db);
    const rev = db.revision;
    code(
      () =>
        db.insert("users", [
          { id: 4, name: "New" },
          { id: 1, name: "duplicate" },
        ]),
      "UNIQUE",
    );
    expect(db.query("users").count()).toBe(3);
    expect(db.query("users", { name: "New" }).count()).toBe(0);
    expect(db.revision).toBe(rev);
  });
  test("invalid writes are atomic", () => {
    const db = open();
    seed(db);
    const before = db.query("users").all();
    code(() => db.update("users", { email: "same" }), "UNIQUE");
    code(() => db.update("users", { age: -1 }, { id: 1 }), "CHECK");
    code(() => db.insert("users", { name: "missing id" }), "NOT_NULL");
    code(() => db.insert("users", { id: 4, name: null }), "NOT_NULL");
    code(() => db.insert("users", { id: 4, name: "Bad", extra: 1 }), "COLUMN");
    code(() => db.update("users", { age: "bad" }, { id: 999 }), "TYPE");
    expect(db.query("users").all()).toEqual(before);
  });
  test("unique allows multiple nulls; keys do not", () => {
    const db = open();
    seed(db);
    code(() => db.insert("users", { id: null, name: "Null" }), "NOT_NULL");
    code(() => db.insert("users", { id: 4, name: "x", email: "a@example.com" }), "UNIQUE");
  });
  test("composite primary and unique keys", () => {
    const db = open([
      {
        name: "pairs",
        pk: ["a", "b"],
        columns: [
          { name: "a", type: "text" },
          { name: "b", type: "number" },
          { name: "c", type: "text" },
        ],
        indexes: [{ name: "unique_pair", columns: ["b", "c"], unique: true }],
      },
    ]);
    db.insert("pairs", [
      { a: "x", b: 1, c: "a" },
      { a: "x", b: 2, c: "a" },
    ]);
    code(() => db.insert("pairs", { a: "x", b: 1 }), "UNIQUE");
    code(() => db.insert("pairs", { a: "y", b: 1, c: "a" }), "UNIQUE");
    expect(db.explain("pairs", { a: "x", b: 1 }).index).toBe("$primary");
  });
  test("JSON equality is independent of property order", () => {
    const db = open();
    db.insert("users", { id: 1, name: "x", profile: { a: 1, b: 2 } });
    expect(db.query("users", eq("profile", { b: 2, a: 1 })).count()).toBe(1);
  });
  test("non-JSON inputs are rejected", () => {
    const db = open(),
      cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    for (const value of [
      NaN,
      Infinity,
      undefined,
      BigInt(1),
      () => 1,
      new Date(),
      cyc,
      [undefined],
    ]) {
      code(() => db.insert("users", { id: 1, name: "x", profile: value as Data }), "TYPE");
    }
  });
  test("boolean, date and time scalar keys are supported", () => {
    const db = open([{ name: "flags", pk: "flag", columns: [{ name: "flag", type: "boolean" }] }]);
    db.insert("flags", [{ flag: true }, { flag: false }]);
    expect(db.query("flags", { flag: false }).count()).toBe(1);
  });
});

describe("conditions and query algebra", () => {
  const cases: [string, ConditionNode, number[]][] = [
    ["equality", eq("name", "Evie"), [1, 3]],
    ["inequality", ne("age", 18), [2]],
    ["greater", gt("age", 18), [2]],
    ["less", lt("age", 20), [1]],
    ["inclusive greater", gte("age", 18), [1, 2]],
    ["inclusive less", lte("age", 18), [1]],
    ["between", between("age", 18, 20), [1, 2]],
    ["in", inList("age", [18, null]), [1]],
    ["null", isNull("age"), [3]],
    ["not null", isNotNull("age"), [1, 2]],
    ["null equality is unknown", eq("age", null), []],
    ["not unknown", not(eq("age", 18)), [2]],
    ["and", and(eq("name", "Evie"), eq("age", 18)), [1]],
    ["or", or(eq("age", 18), isNull("age")), [1, 3]],
    ["like", like("name", "E_i%"), [1, 3]],
    ["empty and", and(), [1, 2, 3]],
    ["empty or", or(), []],
  ];
  for (const [name, where, expected] of cases)
    test(name, () => {
      const db = open();
      seed(db);
      expect(
        db
          .query("users", where)
          .all()
          .map((r) => r.id),
      ).toEqual(expected);
    });
  test("invalid columns and malformed conditions fail even on empty tables", () => {
    const db = open();
    code(() => db.query("users", eq("missing", 1)), "COLUMN");
    code(
      () => db.query("users", { type: "comparison", column: "id", operator: "=" } as ConditionNode),
      "QUERY",
    );
    code(
      () =>
        db.query("users", {
          type: "logical",
          operator: "NOT",
          operands: [],
        } as unknown as ConditionNode),
      "QUERY",
    );
    code(() => db.query("users").select("missing"), "COLUMN");
  });
  test("sorting, projection, distinct and paging are immutable", () => {
    const db = open();
    seed(db);
    const q = db.query("users");
    expect(q.orderBy({ column: "age", direction: "desc" }).limit(2).select("id").all()).toEqual([
      { id: 2 },
      { id: 1 },
    ]);
    expect(q.orderBy({ column: "age", nulls: "first" }).first()?.id).toBe(3);
    expect(q.select("name").distinct().count()).toBe(2);
    expect(q.count()).toBe(3);
    code(() => q.limit(-1), "QUERY");
    code(() => q.orderBy("oops"), "COLUMN");
  });
  test("queries preserve their snapshot after writes", () => {
    const db = open();
    seed(db);
    const q = db.query("users");
    db.delete("users");
    expect(q.count()).toBe(3);
    expect(db.query("users").count()).toBe(0);
  });
  test("grouping, aggregates and having", () => {
    const db = open();
    seed(db);
    expect(
      db
        .query("users")
        .aggregate({
          n: { fn: "count" },
          sum: { fn: "sum", column: "age" },
          avg: { fn: "avg", column: "age" },
          min: { fn: "min", column: "age" },
          max: { fn: "max", column: "age" },
        })
        .first(),
    ).toEqual({ n: 3, sum: 38, avg: 19, min: 18, max: 20 });
    expect(
      db
        .query("users")
        .aggregate({ n: { fn: "count" } }, ["name"])
        .where(gt("n", 1))
        .all(),
    ).toEqual([{ name: "Evie", n: 2 }]);
    expect(
      db
        .query("users")
        .aggregate({ n: { fn: "count", column: "age", distinct: true } })
        .first()?.n,
    ).toBe(2);
  });
  test("empty aggregate and null aggregate results", () => {
    const db = open();
    expect(
      db
        .query("users")
        .aggregate({ n: { fn: "count" }, sum: { fn: "sum", column: "age" } })
        .all(),
    ).toEqual([{ n: 0, sum: null }]);
    expect(
      db
        .query("users")
        .aggregate({ n: { fn: "count" } }, ["name"])
        .all(),
    ).toEqual([]);
    db.insert("users", { id: 1, name: "x", age: null });
    expect(
      db
        .query("users")
        .aggregate({ n: { fn: "count", column: "age" } })
        .first()?.n,
    ).toBe(0);
  });
  test("set union, intersect and except", () => {
    const db = open();
    seed(db);
    const a = db.query("users", { name: "Evie" }),
      b = db.query("users", { id: 1 });
    expect(a.union(b).count()).toBe(2);
    expect(a.union(b, true).count()).toBe(3);
    expect(a.intersect(b).count()).toBe(1);
    expect(a.except(b).first()?.id).toBe(3);
  });
  for (const [kind, count] of [
    ["inner", 1],
    ["left", 3],
    ["right", 2],
    ["full", 4],
  ] as const)
    test(`${kind} join`, () => {
      const db = open();
      seed(db);
      db.createTable({
        name: "notes",
        columns: [
          { name: "userId", type: "number" },
          { name: "text", type: "text" },
        ],
      });
      db.insert("notes", [
        { userId: 1, text: "hello" },
        { userId: null, text: "orphan" },
      ]);
      const q = db
        .query("users")
        .join(db.query("notes"), { alias: "note", type: kind, on: [["id", "userId"]] });
      expect(q.count()).toBe(count);
      expect(q.all()[0]["note.text"]).toBe("hello");
    });
  test("null join keys do not match", () => {
    const db = open();
    seed(db);
    const q = db.query("users");
    expect(q.join(q, { alias: "u", on: [["age", "age"]] }).count()).toBe(2);
  });
});

function relation(action: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION" = "CASCADE"): Table[] {
  return [
    { name: "parents", columns: [{ name: "id", type: "number" }], pk: "id" },
    {
      name: "children",
      columns: [
        { name: "id", type: "number" },
        { name: "parentId", type: "number" },
      ],
      pk: "id",
      references: [
        {
          targetTable: "parents",
          pairs: [{ local: "parentId", away: "id" }],
          onDelete: action,
          onUpdate: "CASCADE",
        },
      ],
    },
  ];
}
describe("referential integrity", () => {
  test("invalid parent rejected and nullable FK accepted", () => {
    const db = open(relation());
    code(() => db.insert("children", { id: 1, parentId: 9 }), "FOREIGN_KEY");
    db.insert("children", { id: 1, parentId: null });
    expect(db.query("children").count()).toBe(1);
  });
  test("update and delete cascades", () => {
    const db = open(relation());
    db.insert("parents", { id: 1 });
    db.insert("children", { id: 2, parentId: 1 });
    db.update("parents", { id: 3 });
    expect(db.query("children").first()?.parentId).toBe(3);
    db.delete("parents");
    expect(db.query("children").count()).toBe(0);
  });
  test("delete SET NULL", () => {
    const db = open(relation("SET NULL"));
    db.insert("parents", { id: 1 });
    db.insert("children", { id: 2, parentId: 1 });
    db.delete("parents");
    expect(db.query("children").first()?.parentId).toBe(null);
  });
  for (const action of ["RESTRICT", "NO ACTION"] as const)
    test(`delete ${action} rolls back`, () => {
      const db = open(relation(action));
      db.insert("parents", { id: 1 });
      db.insert("children", { id: 2, parentId: 1 });
      code(() => db.delete("parents"), "FOREIGN_KEY");
      expect(db.query("parents").count()).toBe(1);
    });
  test("multi-level cascading deletion", () => {
    const schema = relation();
    schema.push({
      name: "leaves",
      columns: [{ name: "childId", type: "number" }],
      references: [
        { targetTable: "children", pairs: [{ local: "childId", away: "id" }], onDelete: "CASCADE" },
      ],
    });
    const db = open(schema);
    db.insert("parents", { id: 1 });
    db.insert("children", { id: 2, parentId: 1 });
    db.insert("leaves", { childId: 2 });
    db.delete("parents");
    expect(db.query("leaves").count()).toBe(0);
  });
  test("self-referential cascade and cycles terminate", () => {
    const db = open([
      {
        name: "nodes",
        columns: [
          { name: "id", type: "number" },
          { name: "parent", type: "number" },
        ],
        pk: "id",
        references: [
          {
            targetTable: "nodes",
            pairs: [{ local: "parent", away: "id" }],
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
        ],
      },
    ]);
    db.insert("nodes", [
      { id: 1, parent: 1 },
      { id: 2, parent: 1 },
    ]);
    db.update("nodes", { id: 3 }, { id: 1 });
    expect(db.query("nodes", { id: 3 }).first()?.parent).toBe(3);
    db.update("nodes", { parent: 2 }, { id: 3 });
    db.delete("nodes", { id: 3 });
    expect(db.query("nodes").count()).toBe(0);
  });
  test("composite FK and MATCH SIMPLE null handling", () => {
    const db = open([
      {
        name: "p",
        columns: [
          { name: "a", type: "number" },
          { name: "b", type: "text" },
        ],
        pk: ["a", "b"],
      },
      {
        name: "c",
        columns: [
          { name: "a", type: "number" },
          { name: "b", type: "text" },
        ],
        references: [
          {
            targetTable: "p",
            pairs: [
              { local: "a", away: "a" },
              { local: "b", away: "b" },
            ],
          },
        ],
      },
    ]);
    db.insert("p", { a: 1, b: "a" });
    db.insert("c", [
      { a: 1, b: "a" },
      { a: 999, b: null },
    ]);
    code(() => db.insert("c", { a: 1, b: "b" }), "FOREIGN_KEY");
  });
  test("FK schema must target unique columns and SET NULL must be nullable", () => {
    const schema = relation();
    delete schema[0].pk;
    code(() => open(schema), "SCHEMA");
    const setNull = relation("SET NULL");
    setNull[1].columns[1].notNull = true;
    code(() => open(setNull), "SCHEMA");
  });
});

describe("transactions, DDL, migrations and operation builders", () => {
  test("commit once and rollback on error", () => {
    const db = open();
    const rev = db.revision;
    db.transaction((tx) => {
      tx.insert("users", { id: 1, name: "a" });
      tx.insert("users", { id: 2, name: "b" });
    });
    expect(db.revision).toBe(rev + 1);
    expect(() =>
      db.transaction((tx) => {
        tx.delete("users");
        throw Error("stop");
      }),
    ).toThrow("stop");
    expect(db.query("users").count()).toBe(2);
  });
  test("nested savepoint rollback leaves outer transaction usable", () => {
    const db = open();
    db.transaction((tx) => {
      tx.insert("users", { id: 1, name: "a" });
      expect(() =>
        tx.transaction((inner) => {
          inner.insert("users", { id: 2, name: "b" });
          throw Error("rollback");
        }),
      ).toThrow("rollback");
      tx.insert("users", { id: 3, name: "c" });
    });
    expect(
      db
        .query("users")
        .all()
        .map((r) => r.id),
    ).toEqual([1, 3]);
  });
  test("closed transaction handles and root access are rejected", () => {
    const db = open();
    let leaked: Database;
    db.transaction((tx) => {
      leaked = tx;
      code(() => db.query("users"), "TRANSACTION");
    });
    code(() => leaked!.insert("users", { id: 1, name: "x" }), "CLOSED");
  });
  test("async transactions are rejected and later writes cannot leak", async () => {
    const db = open();
    code(
      () =>
        db.transaction(async (tx) => {
          tx.insert("users", { id: 1, name: "x" });
          await Promise.resolve();
          tx.insert("users", { id: 2, name: "y" });
        }),
      "TRANSACTION",
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(db.query("users").count()).toBe(0);
  });
  test("statement failure can be caught inside a transaction", () => {
    const db = open();
    db.transaction((tx) => {
      tx.insert("users", { id: 1, name: "a" });
      code(() => tx.insert("users", { id: 1, name: "duplicate" }), "UNIQUE");
      tx.insert("users", { id: 2, name: "b" });
    });
    expect(db.query("users").count()).toBe(2);
  });
  test("create and drop tables atomically", () => {
    const db = open([]);
    db.createTable({ name: "t", columns: [{ name: "id", type: "number" }] });
    db.insert("t", { id: 1 });
    db.dropTable("t");
    expect(db.schema).toEqual([]);
    code(
      () => db.createTable({ name: "bad/path", columns: [{ name: "id", type: "number" }] }),
      "SCHEMA",
    );
  });
  test("add, rename, drop columns and datatype change rollback", () => {
    const db = open();
    seed(db);
    db.alterTable("users", {
      operation: "ADD COLUMN",
      data: { name: "enabled", type: "boolean", default: true, notNull: true },
    });
    expect(db.query("users").first()?.enabled).toBe(true);
    db.alterTable("users", { operation: "RENAME COLUMN", name: "name", newname: "displayName" });
    expect(db.explain("users", { displayName: "Evie" }).access).toBe("index");
    code(
      () =>
        db.alterTable("users", { operation: "MODIFY DATATYPE COLUMN", name: "age", type: "text" }),
      "TYPE",
    );
    db.alterTable("users", { operation: "DROP COLUMN", name: "enabled" });
    expect(db.query("users").first()).not.toHaveProperty("enabled");
  });
  test("renaming a key updates foreign key metadata", () => {
    const db = open(relation());
    db.insert("parents", { id: 1 });
    db.insert("children", { id: 2, parentId: 1 });
    db.alterTable("parents", { operation: "RENAME COLUMN", name: "id", newname: "key" });
    db.update("parents", { key: 3 });
    expect(db.query("children").first()?.parentId).toBe(3);
    code(() => db.dropTable("parents"), "FOREIGN_KEY");
    code(() => db.alterTable("parents", { operation: "DROP COLUMN", name: "key" }), "SCHEMA");
  });
  test("migrations are versioned, idempotent and all-or-nothing", () => {
    const db = open([]);
    const migrations = [
      {
        version: 1,
        up(tx: Database) {
          tx.createTable({ name: "t", columns: [{ name: "id", type: "number" }] });
        },
      },
    ];
    db.migrate(migrations);
    db.migrate(migrations);
    expect(db.version).toBe(1);
    expect(() =>
      db.migrate([
        {
          version: 2,
          up(tx) {
            tx.insert("t", { id: 1 });
          },
        },
        {
          version: 3,
          up() {
            throw Error("fail");
          },
        },
      ]),
    ).toThrow("fail");
    expect(db.version).toBe(1);
    expect(db.query("t").count()).toBe(0);
    code(() => db.migrate([{ version: 3, up() {} }]), "SCHEMA");
  });
  test("the original ORM builders execute queued operations", () => {
    const dir = folder(),
      orm = new ORM(dir);
    orm.create_table({ name: "t", pk: "id", columns: [{ name: "id", type: "number" }] });
    orm.insert("t", { id: 1 });
    orm.select(["*"], "t", orm.eq("id", 1));
    expect(orm.run()).toEqual([undefined, [{ id: 1 }], [{ id: 1 }]]);
    expect(orm.pending()).toEqual([]);
    orm.insert("t", { id: 2 });
    orm.insert("t", { id: 1 });
    code(() => orm.run(), "UNIQUE");
    expect(orm.pending().length).toBe(2);
    const db = new Database({ directory: dir });
    resources.push(db);
    expect(db.query("t").count()).toBe(1);
  });
  test("SELECT operation supports distinct ordering and limit", () => {
    const db = open();
    seed(db);
    expect(
      db.execute({
        operation: "SELECT",
        table: "users",
        columns: ["id"],
        orderBy: [{ column: "id", direction: "desc" }],
        limit: 1,
      }),
    ).toEqual([{ id: 3 }]);
  });
});

describe("indexes and file recovery", () => {
  test("indexes are built over existing rows and kept in sync", () => {
    const db = open();
    seed(db);
    db.createIndex("users", { name: "by_age", columns: ["age"] });
    expect(db.explain("users", { age: 18 }).candidates).toBe(1);
    db.update("users", { age: 21 }, { id: 1 });
    expect(db.query("users", { age: 18 }).count()).toBe(0);
    db.delete("users", { id: 1 });
    expect(db.query("users", { age: 21 }).count()).toBe(0);
    db.dropIndex("users", "by_age");
    expect(db.explain("users", { age: 18 }).access).toBe("scan");
  });
  test("failed unique-index creation leaves the schema unchanged", () => {
    const db = open();
    seed(db);
    code(
      () => db.createIndex("users", { name: "unique_name", columns: ["name"], unique: true }),
      "UNIQUE",
    );
    expect(db.schema[0].indexes?.length).toBe(1);
  });
  test("reopen persists rows, schema, version and rebuilt indexes", () => {
    const dir = folder(),
      db = open(usersSchema(), dir);
    seed(db);
    db.checkpoint();
    db.close();
    const reopened = new Database({ directory: dir });
    resources.push(reopened);
    expect(reopened.query("users").count()).toBe(3);
    expect(reopened.explain("users", { name: "Evie" }).access).toBe("index");
    expect(reopened.integrityCheck()).toBe(true);
  });
  test("checkpoint corruption and leftover temporary writes cannot override commits", () => {
    const dir = folder(),
      db = open(usersSchema(), dir);
    seed(db);
    db.checkpoint();
    db.close();
    writeFileSync(join(dir, "users", "_table.json"), "corrupt");
    writeFileSync(join(dir, "schema.json"), "corrupt");
    writeFileSync(join(dir, ".commit-leftover.tmp"), "partial");
    const recovered = new Database({ directory: dir });
    resources.push(recovered);
    expect(recovered.query("users").count()).toBe(3);
    recovered.checkpoint();
    expect(JSON.parse(readFileSync(join(dir, "users", "_table.json"), "utf8")).length).toBe(3);
  });
  test("checksum corruption is rejected without overwriting data", () => {
    const dir = folder(),
      db = open(usersSchema(), dir);
    seed(db);
    db.close();
    const p = join(dir, "db.wal"),
      content = readFileSync(p, "utf8");
    writeFileSync(p, content.replace("Evie", "Evil"));
    code(() => new Database({ directory: dir }), "CORRUPT");
    expect(readFileSync(p, "utf8")).toContain("Evil");
    expect(existsSync(join(dir, ".lock"))).toBe(false);
  });
  test("missing journal alongside a checkpoint fails safely", () => {
    const dir = folder(),
      db = open(usersSchema(), dir);
    db.checkpoint();
    db.close();
    unlinkSync(join(dir, "db.wal"));
    code(() => new Database({ directory: dir }), "CORRUPT");
  });
  test("a failed write leaves the prior committed database usable", () => {
    const dir = folder(),
      db = open(usersSchema(), dir);
    seed(db);
    const token = JSON.parse(readFileSync(join(dir, ".lock"), "utf8")).token,
      blocker = join(dir, `.commit-${token}.tmp`);
    mkdirSync(blocker);
    code(() => db.insert("users", { id: 4, name: "new" }), "STORAGE");
    expect(db.query("users").count()).toBe(3);
    rmSync(blocker, { recursive: true });
    db.insert("users", { id: 4, name: "new" });
    expect(db.query("users").count()).toBe(4);
  });
  test("exclusive opens, closed handles and failed-open lock cleanup", () => {
    const dir = folder(),
      db = open(usersSchema(), dir);
    code(() => new Database({ directory: dir }), "LOCKED");
    db.close();
    code(() => db.query("users"), "CLOSED");
    code(() => new Database({ directory: dir, schema: [] }), "SCHEMA");
    const reopened = new Database({ directory: dir });
    resources.push(reopened);
    expect(reopened.query("users").count()).toBe(0);
  });
});

const validTypes: [string, Data][] = [
  ["number", 1],
  ["boolean", true],
  ["text", ""],
  ["jsonb", {}],
  ["uuid", "123e4567-e89b-42d3-a456-426614174000"],
  ["date", "20240229"],
  ["time", "235959.5"],
];
for (const [type, value] of validTypes)
  test(`datatype ${type}`, () =>
    expect(validateType(type as Parameters<typeof validateType>[0], value)).toBe(true));
test("invalid dates, UUID defaults and unsafe numeric data", () => {
  expect(validateType("date", "20230229")).toBe(false);
  expect(validateType("date", "20240431")).toBe(false);
  expect(validateType("number", NaN)).toBe(false);
  expect(validateType("jsonb", null)).toBe(false);
  expect(
    new Schema([
      { name: "t", columns: [{ name: "id", type: "uuid", default: true }] },
    ]).validateSchema()[0],
  ).toBe(false);
});
