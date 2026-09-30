# API and behavior

## Opening and closing

`new Database({ schema?, directory?, version? })` opens the engine synchronously. Omitting
`directory` creates an in-memory database. Omitting `schema` creates an empty catalog, or loads
the catalog from the existing journal. A new database starts at version and revision zero.
`version` is a non-negative integer; an explicitly supplied schema/version must match an
existing database. Directory paths support `~` and `~/...`.

`db.schema` returns a detached catalog. `db.version` is the migration version; `db.revision`
increases after each successful statement or outer transaction. Failed operations leave the
revision unchanged. `close()` releases the file lock and invalidates live table handles; it
is idempotent. A materialized `Query` remains usable after database closure.

`Schema.validateSchema()` preserves the original `[boolean, message]` API and checks the same
relational definitions, after its original structural checks. The legacy standalone validator
requires at least one table. `Database` permits an empty catalog for incremental creation.

## Definitions and values

A `Table` has `name`, non-empty `columns`, and optional `pk`, `indexes`, `references`, `checks`
and JSON `metadata`. A column has `name`, `type`, optional `unique`, `notNull` and `default`.
Identifiers are case-sensitive ASCII letters followed by letters, digits or underscores.
They cannot begin with an underscore; `constructor` and `prototype` are reserved.

| Type      | Accepted values                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `number`  | Finite JavaScript numbers; JavaScript precision applies                                                                                  |
| `boolean` | `true` / `false`                                                                                                                         |
| `text`    | Strings, with case-sensitive equality and ordering                                                                                       |
| `jsonb`   | Plain JSON objects or arrays, recursively containing finite JSON values                                                                  |
| `uuid`    | UUID v4 strings, validated without automatic generation                                                                                  |
| `date`    | Compact strings: `YYYY`, `YYYYMM`, `YYYYMMDD`, optionally followed by `HH`, `MM`, `SS.fraction` in order; real calendar days are checked |
| `time`    | Compact strings: `HH`, `HHMM` or `HHMMSS.fraction`                                                                                       |

Nullable columns accept `null`. Missing insert fields use their declared default, otherwise
`null`. `undefined` is rejected, including nested JSON. Dates/UUIDs remain strings. JSON values
reject cycles, functions, bigint, symbols, non-finite numbers, sparse arrays and class instances.
JSON equality compares objects independently of property order and arrays in element order.
No type coercion or automatic increment/generation is performed.

`pk` is a column name or a non-empty list of distinct column names. Its columns are implicitly
non-null and its tuple is unique. Every other scalar type can form a key; `jsonb` cannot.
`unique: true` declares a single-column unique key. An index with `unique: true` declares a
compound unique key. Unique keys permit repeated tuples containing any null component.

Foreign keys specify `targetTable` and ordered `{ local, away }` pairs. Target columns must
exactly match a primary or unique key in its declared order. Column types must match. A tuple
with any null component passes the foreign key check (MATCH SIMPLE). References may be cyclic
or self-referential. Seed mutually referencing rows using nullable fields, then update them.

`onDelete` supports `CASCADE`, `SET NULL`, `RESTRICT` and `NO ACTION`.
`onUpdate` supports `CASCADE`, `RESTRICT` and `NO ACTION`. Defaults are `NO ACTION`.
`SET NULL` requires nullable local fields outside the primary key. `RESTRICT` rejects a parent
change when it still has referencing rows. `NO ACTION` checks the state after all referential
actions for that statement. `checks` contains condition trees; a false result rejects a row,
while true or unknown passes. Constraints are enforced at statement boundaries, including
inside transactions; there is no deferred-constraint mode.

## Reads and writes

`db.table(name)` provides a typed table handle when a literal schema was supplied.
`db.query(name, where?)`, `insert(name, rowOrRows)`, `update(name, patch, where?)` and
`delete(name, where?)` provide equivalent dynamic access, useful during migrations.

| Table method               | Result                                                         |
| -------------------------- | -------------------------------------------------------------- |
| `insert(rowOrRows)`        | Detached array of inserted rows; one batch is atomic           |
| `all()` / `filter(where)`  | Detached row array                                             |
| `query(where?)`            | Immutable materialized query snapshot                          |
| `count(where?)`            | Number of matching rows                                        |
| `update(patch, where?)`    | Count of directly matched rows, excluding cascades             |
| `delete(where?)`           | Count of directly deleted rows, excluding cascades             |
| `explain(where?)`          | Access plan: scan/index, index name, candidates and total rows |
| `for (const row of table)` | Detached snapshot rows in insertion order                      |

A missing filter matches all rows. Updates merge the supplied fields and retain all other
fields. Unknown columns and invalid patch types fail even when no rows match. A constraint
failure rolls back the entire statement, including cascades. Updates preserve internal row
identities and insertion order. Tables without a declared primary key still receive private
row identities; these are omitted from query results. Insert arguments are partial at the
TypeScript level to allow omitted defaults; the runtime enforces required fields.

`where` accepts a condition tree or equality shorthand, such as `{ name: "Evie" }`.
Shorthand fields are combined with AND; shorthand `null` means `IS NULL`. An explicit
comparison/logical operation object takes precedence when it has `type` and `operator`.

Conditions are built with `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `like`, `between`, `inList`,
`isNull`, `isNotNull`, `and(...conditions)`, `or(...conditions)` and `not(condition)`.
Comparisons use three-valued logic: comparisons involving null produce unknown, and filtering
keeps only true. Use `isNull` rather than `eq(column, null)`. Empty AND is true; empty OR is
false; empty IN is false. Ordered comparisons require two numbers or two strings of matching
types. LIKE is case-sensitive, `%` matches any number of Unicode characters and `_` matches
one Unicode character. Pattern characters other than `%`/`_` are literal; there is no escape
clause. BETWEEN is inclusive. IN follows null-aware comparison semantics.

## Query algebra

Every query transformation returns a new snapshot. Unknown columns fail even for empty
queries. Projection/order/filter operations preserve the column catalog so subsequent
operations can validate column names.

```ts
const result = db
  .table("users")
  .query(gte("age", 18))
  .orderBy({ column: "age", direction: "desc", nulls: "last" })
  .limit(10, 20)
  .select("id", "name")
  .all();
```

- `where(conditionOrShorthand)` filters a snapshot. `where(row => boolean)` also accepts a
  JavaScript predicate, called with detached rows. Indexed retrieval happens in the initial
  `table.query(where)` / `db.query(name, where)` call.
- `select(...columns)` projects distinct named columns; `all`, `first`, `count` and iteration
  return copied rows, an optional first row, a count, and copied rows respectively.
- `orderBy(...columnNamesOrOrderObjects)` uses stable ordering. Direction defaults to `asc`.
  Nulls default to last in either direction. Text order uses JavaScript string ordering.
- `limit(count, offset = 0)` accepts non-negative safe integers.
- `distinct()` deduplicates complete projected rows using canonical JSON equality.
- `union(other, all = false)`, `intersect(other)`, `except(other)` require the same named columns.
  Union deduplicates unless `all` is true; intersect/except always deduplicate. Column values
  use DB-Thing's JSON equality without type coercion.

Join queries with one or more equality column pairs:

```ts
const joined = db.query("users").join(db.query("posts"), {
  on: [["id", "authorId"]],
  alias: "post",
  type: "left",
});
```

Join types are `inner` (default), `left`, `right`, `full`. Right-hand column names become
`post.id`, `post.authorId`, etc. Join aliases cannot collide with existing query columns.
Null join keys never match. Outer rows fill missing fields with null; inferred join types
conservatively allow nulls on both sides. Joins use hash lookup of complete equality tuples.

```ts
const totals = joined
  .aggregate(
    {
      posts: { fn: "count", column: "post.id" },
      meanAge: { fn: "avg", column: "age" },
    },
    ["name"],
  )
  .where(gt("posts", 0));
```

`aggregate(spec, groupBy = [])` supports count/sum/avg/min/max. Keys are output aliases.
Count without a column or with `column: "*"` counts rows. Named-column aggregates ignore nulls.
`distinct: true` deduplicates non-null values; it requires a column. Sum/average require
numbers and fail on overflow. An empty ungrouped input produces one row: zero count and null
for other aggregates. An empty grouped input produces no rows. Follow aggregation with `where`
for HAVING behavior. Group fields and aggregate aliases must be distinct. Aggregation results
use dynamic `Row` types.

## Transactions and migrations

`db.transaction(tx => result)` commits all callback changes once or rolls them back when the
callback throws. Use the supplied handle; the parent handle rejects access during the callback.
Nested transactions act as savepoints. A caught failed inner transaction leaves the outer
handle usable. Statement errors caught inside a callback also leave the transaction usable.
Transaction handles expire after the callback and cannot be closed manually. Return values
are passed back to the caller; escaping query snapshots remain usable. Promise-returning
callbacks are rejected and rolled back. Later accesses through an expired handle fail.

`migrate([{ version, up(db) }, ...])` sorts unique positive versions, skips already-applied
versions and requires remaining versions to be contiguous. All pending migrations execute in
one transaction. `up` must be synchronous. The schema version advances only if all migrations
succeed. Opening with an old schema after migration fails; reopen without a supplied schema,
or with the migrated schema.

DDL methods are `createTable(definition)`, `dropTable(name)`, `createIndex(table, definition)`
and `dropIndex(table, name)`. A table still referenced by another table cannot be dropped.
Dropping a unique index required by a foreign key fails.

`alterTable(table, modification)` supports the original operations `ADD COLUMN`, `DROP COLUMN`,
`RENAME COLUMN`, `MODIFY DATATYPE COLUMN`. Adding a field backfills existing rows with its
default or null. Renaming updates primary keys, indexes, checks and both sides of foreign keys.
Dropping a field used by a key/index/reference/check fails. Type changes validate existing
values and references without coercion; a supplied default changes the default. DDL is atomic
and can run inside transactions.

## Operation objects and diagnostics

`execute(operation)` accepts the exported `Database_Operation` union: SELECT, INSERT, UPDATE,
DELETE, CREATE TABLE, DROP TABLE, ALTER TABLE. SELECT permits `columns: ["*"]`, `conditions`,
`orderBy`, `distinct`, `limit`, `offset`. It filters/orders source rows, projects, deduplicates,
then pages. `executeBatch(operations)` executes sequentially in one transaction and returns an
array of operation results. SELECT/INSERT return row arrays, UPDATE/DELETE return counts, DDL
returns undefined.

`new ORM(directory, initialSchema?)` retains the original builders, queues each operation,
and exposes `pending()`, `clear()` and `run()`. `run()` commits the entire queue or rolls it back;
on success it clears the queue, on failure it retains it. The local database is closed before
`run()` returns. Condition helpers are pure and do not enqueue operations.

`explain(table, where?)` describes candidate retrieval. Primary/unique keys have automatic
hash indexes. Explicit indexes can cover multiple scalar columns. The planner selects the
smallest complete equality-key candidate set available from AND-connected equality/IS NULL
conditions. Remaining predicates are still evaluated. Other predicates scan rows. Indexes
are reconstructed from committed rows on opening and rebuilt after successful writes.

`integrityCheck()` validates the catalog, values, keys, checks, references, row maps and index
entries, returning true or throwing. `checkpoint()` exports human-readable schema/table/index
caches for a persistent database; it is a no-op for an in-memory database.

`DatabaseError.code` is one of `SCHEMA`, `TABLE`, `COLUMN`, `TYPE`, `NOT_NULL`, `UNIQUE`,
`FOREIGN_KEY`, `CHECK`, `QUERY`, `TRANSACTION`, `CLOSED`, `LOCKED`, `CORRUPT`, `STORAGE`.
A storage error after commit publication has an uncertain durability outcome: the database
blocks further access until it is closed and reopened. See the storage document for recovery.
