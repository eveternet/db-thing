// Public entrypoint for Node/TS consumers
export { Schema } from "./schema/schema";
export type { DataType, Data, Pair, ForeignKey, Column, Table } from "./types";
export { validateType } from "./datatype_validator";

// Optional: add a CLI later via src/cli.ts and a "bin" field in package.json
