import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database, DatabaseError, type Table } from "../src/index.js";
import { Storage } from "../src/dbms/storage.js";

const dirs: string[] = [],
  handles: { close(): void }[] = [];
afterEach(() => {
  for (const db of handles.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const schema: Table[] = [{ name: "items", pk: "id", columns: [{ name: "id", type: "number" }] }];
function create() {
  const dir = mkdtempSync(join(tmpdir(), "dbthing-recovery-"));
  dirs.push(dir);
  const db = new Database({ directory: dir, schema });
  handles.push(db);
  return { db, dir };
}

test("publication followed by fsync failure blocks access until recovery", () => {
  const { db, dir } = create();
  const sync = spyOn(
    Storage.prototype as unknown as { syncDirectory(): void },
    "syncDirectory",
  ).mockImplementation(() => {
    throw Error("simulated fsync failure");
  });
  try {
    expect(() => db.insert("items", { id: 1 })).toThrow(DatabaseError);
    expect(() => db.query("items")).toThrow("requires recovery");
  } finally {
    sync.mockRestore();
    db.close();
  }
  const reopened = new Database({ directory: dir });
  handles.push(reopened);
  expect(reopened.query("items").all()).toEqual([{ id: 1 }]);
});

test("a checksummed but invalid database is rejected as corruption", () => {
  const { db, dir } = create();
  db.insert("items", { id: 1 });
  db.close();
  const journal = join(dir, "db.wal"),
    envelope = JSON.parse(readFileSync(journal, "utf8")),
    state = JSON.parse(envelope.data);
  state.rows.items.push({ id: state.nextId++, value: { id: 1 } });
  envelope.data = JSON.stringify(state);
  envelope.checksum = createHash("sha256").update(envelope.data).digest("hex");
  writeFileSync(journal, JSON.stringify(envelope));
  try {
    new Database({ directory: dir });
    throw Error("should fail");
  } catch (e) {
    expect(e).toBeInstanceOf(DatabaseError);
    expect((e as DatabaseError).code).toBe("CORRUPT");
  }
});

test("migration version and altered schema survive reopening", () => {
  const { db, dir } = create();
  db.migrate([
    {
      version: 1,
      up(tx) {
        tx.alterTable("items", {
          operation: "ADD COLUMN",
          data: { name: "name", type: "text", default: "Evie" },
        });
        tx.insert("items", { id: 1 });
      },
    },
  ]);
  db.close();
  const reopened = new Database({ directory: dir });
  handles.push(reopened);
  expect(reopened.version).toBe(1);
  expect(reopened.query("items").all()).toEqual([{ id: 1, name: "Evie" }]);
});

test("filter shorthand supports a column named type", () => {
  const db = new Database({ schema: [{ name: "t", columns: [{ name: "type", type: "text" }] }] });
  handles.push(db);
  db.insert("t", { type: "comparison" });
  expect(db.query("t", { type: "comparison" }).count()).toBe(1);
});

test("source columns may order a SELECT projection", () => {
  const db = new Database({
    schema: [
      {
        name: "t",
        columns: [
          { name: "id", type: "number" },
          { name: "score", type: "number" },
        ],
      },
    ],
  });
  handles.push(db);
  db.insert("t", [
    { id: 1, score: 10 },
    { id: 2, score: 1 },
  ]);
  expect(
    db.execute({
      operation: "SELECT",
      table: "t",
      columns: ["id"],
      orderBy: [{ column: "score" }],
      limit: 1,
    }),
  ).toEqual([{ id: 2 }]);
});
