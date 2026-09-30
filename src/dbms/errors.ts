export type ErrorCode =
  | "SCHEMA"
  | "TABLE"
  | "COLUMN"
  | "TYPE"
  | "NOT_NULL"
  | "UNIQUE"
  | "FOREIGN_KEY"
  | "CHECK"
  | "QUERY"
  | "TRANSACTION"
  | "CLOSED"
  | "LOCKED"
  | "CORRUPT"
  | "STORAGE";

export class DatabaseError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DatabaseError";
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new DatabaseError(code, message);
}
