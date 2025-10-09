// Public entrypoint for Node/TS consumers
export { Schema } from "./lib/schema/schema";
export type { DataType, Data, Pair, ForeignKey, Column, Table } from "./lib/types";
export { validateType } from "./lib/datatype_validator";

// Optional: add a CLI later via src/cli.ts and a "bin" field in package.json
