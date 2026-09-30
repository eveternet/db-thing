# Files, commits and recovery

The database directory contains a checksummed commit image and optional readable caches:

| Path                    | Role                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `db.wal`                | Authoritative journal containing the latest complete committed database image |
| `.lock`                 | Exclusive owner record with a process ID and random ownership token           |
| `.commit-<token>.tmp`   | Temporary journal image during a commit                                       |
| `schema.json`           | Schema/version cache, produced by `checkpoint()`                              |
| `<table>/_table.json`   | Table cache with internal `_pk` row identities, produced by `checkpoint()`    |
| `<table>/_indexes.json` | Secondary/key index cache, produced by `checkpoint()`                         |

The journal envelope contains a format version, SHA-256 checksum and serialized data string.
Its database image includes the catalog, all rows, internal identity counter, migration version
and revision. All data fits in memory. Each mutation copies the current image, applies changes,
checks all constraints and constructs the new indexes. A successful standalone mutation or
outer transaction publishes one complete image. Transaction statements validate their private
copies; only the outer commit reaches disk.

## Publication sequence

1. Open a temporary image in the database directory with exclusive creation and mode `0600`.
2. Serialize the complete database, write the envelope, flush the file with `fsync`, then close it.
3. Atomically rename the temporary file over `db.wal`.
4. Flush the database directory on POSIX systems, then expose the new state to the caller.

Creating a new database directory also flushes its newly created parent directory entries on
POSIX systems. Windows flushes file contents; directory syncing is skipped there.
Atomic replacement and flushing guarantees depend on the local filesystem and hardware.
Network/synchronized filesystems and external edits while open are outside the supported model.
The process-crash tests exercise complete commits and uncommitted transactions; they do not
simulate physical power loss across all storage devices.

Errors before publication leave the previous journal and in-memory state in place. An error
after rename but before durability confirmation raises `STORAGE` and marks the handle unusable.
Close/reopen to learn the recovered outcome; retrying the operation blindly can duplicate work.
Temporary files are ignored on recovery. A fully written temporary file is still uncommitted.

## Opening and checking

Opening acquires the lock, verifies the journal checksum/format, validates the recovered catalog
and every constraint, and rebuilds row maps and indexes from committed rows. Invalid committed
images fail with `CORRUPT`; opening does not overwrite them. A missing journal alongside a
checkpoint also fails with `CORRUPT`.

`checkpoint()` creates or refreshes the readable schema, table and combined index caches. These
caches are derived exports and can be partially written if checkpointing is interrupted. Opening
uses the committed journal and ignores their contents. Calling `checkpoint()` again repairs the
current tables' caches. Cache files for formerly dropped tables can remain until removed by the
owner; they have no effect on the catalog. Closing releases the lock without forcing a checkpoint.

`integrityCheck()` validates both committed in-memory relations and the derived in-memory indexes.
Checksums detect accidental journal corruption; they provide no authentication against someone
with permission to edit the entire database directory.

## Ownership and crash cleanup

The file lock is held by one database handle. Another opener, including a reader or another
process, receives `LOCKED`. `close()` only removes a lock whose ownership token matches.

An abrupt process exit can leave `.lock`. Recovery is deliberately manual to avoid evicting a
live process or racing another opener:

1. Stop every application that might open the directory.
2. Inspect `.lock` and verify its recorded process has exited. Account for PID reuse.
3. Remove only the stale `.lock` file.
4. Reopen the database; the journal determines the recovered committed state.

For backups, close the database and copy the directory. The authoritative image is `db.wal`;
copying cache files alone does not produce a recoverable database. Keep a backup before attempting
manual repair of a corrupt journal.

This format keeps correctness and recovery explicit while the engine remains small. Complete
image copying, validation and serialization make writes proportional to total database size.
The format can be replaced by page storage or an append journal in a future version with an
explicit migration, rather than silently changing existing databases.
