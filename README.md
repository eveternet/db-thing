# DB-Thing

> What if I made a DBMS that doesn't use strings as its syntax?

DB-Thing is an embedded relational database with a function-based TypeScript API. It implements
its own storage and query engine and has zero runtime package dependencies. Use it in Node 22+
or Bun, in memory or in a local directory.

The original experiment now executes queries and persists data:

- Tables, validated scalar/JSON columns, defaults and nullability.
- Primary keys, compound keys, unique constraints and declarative checks.
- Foreign keys with cascading updates/deletes, restricted deletes and `SET NULL`.
- Inserts, updates, deletes and atomic batches.
- Filtering, projection, ordering, pagination, distinct and set operations.
- Inner, left, right and full joins; grouping, count/sum/avg/min/max and having filters.
- Automatic key indexes, explicit compound secondary indexes and query plans.
- Synchronous transactions, nested savepoints and versioned migrations.
- Checksummed commit storage, crash recovery, exclusive process locks and integrity checks.

## Quick start

```sh
bun install --frozen-lockfile
bun run check
bun run dev
```

```ts
import { Database, gte } from "./dist/index.js";

const db = new Database({
  // Add directory: "./my-database" to persist this database.
  schema: [
    {
      name: "users",
      pk: "id",
      columns: [
        { name: "id", type: "number" },
        { name: "name", type: "text", notNull: true },
        { name: "age", type: "number", default: 18 },
      ],
      indexes: [{ name: "by_name", columns: ["name"] }],
    },
  ],
});

try {
  db.table("users").insert({ id: 1, name: "Evie" });
  console.log(db.table("users").filter({ name: "Evie" }));
  console.log(db.table("users").query(gte("age", 18)).select("name").all());

  db.transaction((tx) => {
    tx.table("users").update({ age: 19 }, { id: 1 });
  });
} finally {
  db.close();
}
```

With a literal schema, table names, selected columns and row scalar types are inferred.
The runtime validates every write, including values coming from JavaScript or external input.
An insert returns an array of inserted rows; an update/delete returns the number of directly
matched rows. Returned rows are detached copies.

To reopen a persisted database, use `new Database({ directory: "./my-database" })`.
Supplying a schema when reopening requires it to match the stored schema. Apply changes with
migrations using the API described in [docs/api.md](docs/api.md).

## Existing builders

The original `orm` class is exported as both `orm` and `ORM`. Its operation builders still return
operation objects. `run()` executes the queued operations as one transaction. You can also pass
individual operation objects to `Database.execute()` or arrays to `executeBatch()`.

## Operating limits

The engine loads the database into RAM. Each write validates a copied database and publishes a
complete image; batch writes and transactions reduce disk commits. Equality conditions use hash
indexes when the complete index key is available. Range conditions scan rows.

A persistent directory has one exclusive opener, including readers. Operations and transaction
callbacks are synchronous. This implementation targets small embedded databases; it has no
server protocol, concurrent reader/writer mode, SQL parser, triggers, stored procedures or
page-based storage. Performance against SQLite has not been benchmarked.

[docs/api.md](docs/api.md) specifies query and constraint behavior.
[docs/file_methodology.md](docs/file_methodology.md) specifies durability and recovery, including
manual stale-lock recovery after a crash. POSIX directory syncing is used on Linux/macOS;
Windows flushes file contents and has a weaker power-loss guarantee. Use a local filesystem
that implements atomic replacement and flushing correctly.

## Verification

`bun run check` runs type checking (including negative API type tests), Bun tests, a declaration
build, Node integration/crash tests and formatting checks. The test suite includes seeded
comparisons with SQLite for predicates, mutations, joins and grouped aggregates. SQLite is
used only as a test oracle. CI runs the checks with Node 22 and 24.

## License

The original author permits doing whatever you want with these files. No formal license file
has been added.
