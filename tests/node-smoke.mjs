import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Database, eq } from "../dist/index.js";
const schema = [
  {
    name: "items",
    pk: "id",
    columns: [
      { name: "id", type: "number" },
      { name: "name", type: "text" },
    ],
  },
];
function child(code) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { Database } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};${code}`,
    ],
    { encoding: "utf8" },
  );
}

test("built ESM package works in Node without Bun or runtime dependencies", () => {
  const db = new Database({ schema });
  try {
    db.insert("items", { id: 1, name: "Evie" });
    assert.deepEqual(db.query("items", eq("id", 1)).all(), [{ id: 1, name: "Evie" }]);
  } finally {
    db.close();
  }
});

test("cross-process lock excludes a second opener", () => {
  const dir = mkdtempSync(join(tmpdir(), "db-thing-node-")),
    db = new Database({ schema, directory: dir });
  try {
    const result = child(
      `try { new Database({directory:${JSON.stringify(dir)}}); process.exit(3); } catch(e) { if(e.code !== 'LOCKED') throw e; }`,
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("abrupt process termination recovers the committed transaction", () => {
  const dir = mkdtempSync(join(tmpdir(), "db-thing-crash-"));
  try {
    const result = child(
      `const db = new Database({directory:${JSON.stringify(dir)},schema:${JSON.stringify(schema)}}); db.transaction(tx => {tx.insert('items',{id:1,name:'one'});tx.insert('items',{id:2,name:'two'});}); process.kill(process.pid,'SIGKILL');`,
    );
    assert.equal(result.signal, "SIGKILL", result.stderr);
    const owner = JSON.parse(readFileSync(join(dir, ".lock"), "utf8"));
    assert.throws(() => process.kill(owner.pid, 0));
    unlinkSync(join(dir, ".lock"));
    const db = new Database({ directory: dir });
    try {
      assert.equal(db.query("items").count(), 2);
      assert.equal(db.integrityCheck(), true);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uncommitted transaction disappears after abrupt process termination", () => {
  const dir = mkdtempSync(join(tmpdir(), "db-thing-rollback-"));
  try {
    const result = child(
      `const db = new Database({directory:${JSON.stringify(dir)},schema:${JSON.stringify(schema)}}); db.insert('items',{id:1,name:'before'}); db.transaction(tx => {tx.insert('items',{id:2,name:'uncommitted'});process.kill(process.pid,'SIGKILL');});`,
    );
    assert.equal(result.signal, "SIGKILL", result.stderr);
    unlinkSync(join(dir, ".lock"));
    const db = new Database({ directory: dir });
    try {
      assert.deepEqual(db.query("items").all(), [{ id: 1, name: "before" }]);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("termination during a partial journal write preserves the previous commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "db-thing-partial-"));
  try {
    const result = child(`
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const db = new Database({directory:${JSON.stringify(dir)},schema:${JSON.stringify(schema)}});
      db.insert('items',{id:1,name:'before'});
      const write = fs.writeFileSync;
      fs.writeFileSync = (fd, data, ...rest) => {
        if (typeof data === 'string' && data.startsWith('{"format":')) {
          write(fd, data.slice(0, Math.floor(data.length / 2)), ...rest);
          process.kill(process.pid,'SIGKILL');
        }
        return write(fd, data, ...rest);
      };
      syncBuiltinESMExports();
      db.insert('items',{id:2,name:'partial'});
    `);
    assert.equal(result.signal, "SIGKILL", result.stderr);
    unlinkSync(join(dir, ".lock"));
    const db = new Database({ directory: dir });
    try {
      assert.deepEqual(db.query("items").all(), [{ id: 1, name: "before" }]);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("termination after journal rename recovers a complete image", () => {
  const dir = mkdtempSync(join(tmpdir(), "db-thing-publish-"));
  try {
    const result = child(`
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const db = new Database({directory:${JSON.stringify(dir)},schema:${JSON.stringify(schema)}});
      db.insert('items',{id:1,name:'before'});
      const sync = fs.fsyncSync;
      fs.fsyncSync = fd => {
        if (fs.fstatSync(fd).isDirectory()) process.kill(process.pid,'SIGKILL');
        return sync(fd);
      };
      syncBuiltinESMExports();
      db.insert('items',{id:2,name:'published'});
    `);
    assert.equal(result.signal, "SIGKILL", result.stderr);
    unlinkSync(join(dir, ".lock"));
    const db = new Database({ directory: dir });
    try {
      assert.deepEqual(db.query("items").all(), [
        { id: 1, name: "before" },
        { id: 2, name: "published" },
      ]);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
