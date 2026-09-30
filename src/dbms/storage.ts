import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { DatabaseError, fail } from "./errors.js";
import type { State } from "./catalog.js";

const active = new Set<string>();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export class Storage {
  readonly directory: string;
  private token = randomUUID();
  private locked = false;
  poisoned = false;

  constructor(directory: string) {
    this.directory = resolve(
      directory === "~"
        ? homedir()
        : directory.startsWith("~/")
          ? join(homedir(), directory.slice(2))
          : directory,
    );
    if (active.has(this.directory)) fail("LOCKED", "Database is already open in this process");
    try {
      const firstCreated = mkdirSync(this.directory, { recursive: true });
      if (firstCreated) {
        let current = this.directory;
        while (true) {
          this.syncDirectory(dirname(current));
          if (current === firstCreated || dirname(current) === current) break;
          current = dirname(current);
        }
      }
    } catch (e) {
      throw new DatabaseError("STORAGE", "Cannot create a durable database directory", {
        cause: e,
      });
    }
    let fd: number;
    try {
      fd = openSync(join(this.directory, ".lock"), "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        fail(
          "LOCKED",
          "Database is locked. After a crash, verify the recorded owner is gone before removing .lock",
        );
      throw new DatabaseError("STORAGE", "Cannot lock database", { cause: e });
    }
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.token }));
      fsyncSync(fd);
    } catch (e) {
      unlinkSync(join(this.directory, ".lock"));
      throw e;
    } finally {
      closeSync(fd);
    }
    active.add(this.directory);
    this.locked = true;
  }

  load(): State | undefined {
    const file = join(this.directory, "db.wal");
    if (!existsSync(file)) {
      if (existsSync(join(this.directory, "schema.json")))
        fail("CORRUPT", "Checkpoint exists but the authoritative journal is missing");
      return undefined;
    }
    try {
      const envelope = JSON.parse(readFileSync(file, "utf8"));
      if (
        envelope.format !== 1 ||
        typeof envelope.data !== "string" ||
        envelope.checksum !== digest(envelope.data)
      )
        fail("CORRUPT", "Invalid commit journal checksum or format");
      return JSON.parse(envelope.data) as State;
    } catch (e) {
      throw new DatabaseError("CORRUPT", "Cannot recover database journal", { cause: e });
    }
  }

  private syncDirectory(directory = this.directory): void {
    // Windows does not offer POSIX directory fsync through Node. File contents are still flushed.
    if (process.platform === "win32") return;
    const fd = openSync(directory, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  save(state: State): void {
    const file = join(this.directory, "db.wal");
    const tmp = join(this.directory, `.commit-${this.token}.tmp`);
    let published = false;
    try {
      const data = JSON.stringify(state);
      const fd = openSync(tmp, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ format: 1, checksum: digest(data), data }));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, file);
      published = true;
      this.syncDirectory();
    } catch (e) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        /* Preserve the original I/O error. */
      }
      this.poisoned = published;
      throw new DatabaseError(
        "STORAGE",
        published
          ? "Commit publication occurred but durability confirmation failed; close and reopen to recover"
          : "Commit failed; previous database is intact",
        { cause: e },
      );
    }
  }

  checkpoint(state: State, indexes: Record<string, unknown>): void {
    // These files are human-readable caches. Recovery always uses the journal.
    writeFileSync(
      join(this.directory, "schema.json"),
      JSON.stringify({ version: state.version, tables: state.schema }, null, 2),
      { mode: 0o600 },
    );
    for (const t of state.schema) {
      const dir = join(this.directory, t.name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "_table.json"),
        JSON.stringify(
          state.rows[t.name].map((r) => ({ _pk: r.id, ...r.value })),
          null,
          2,
        ),
        { mode: 0o600 },
      );
      writeFileSync(join(dir, "_indexes.json"), JSON.stringify(indexes[t.name], null, 2), {
        mode: 0o600,
      });
    }
  }

  close(): void {
    if (!this.locked) return;
    const file = join(this.directory, ".lock");
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).token === this.token)
      unlinkSync(file);
    active.delete(this.directory);
    this.locked = false;
  }
}
