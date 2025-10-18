export type DataType = "number" | "text" | "boolean" | "date" | "uuid" | "time" | "jsonb";
export type Data = string | number | boolean | object;

export const default_data_types: DataType[] = [
  "number",
  "text",
  "boolean",
  "date",
  "uuid",
  "jsonb",
  "time",
];

export const non_scalar_types: DataType[] = ["boolean", "date", "time"];

export type Pair = {
  local: string;
  away: string;
};

export type ForeignKey = {
  targetTable: string; // which table this FK targets
  pairs: Pair[]; // Composite then just have more than 1 value in array, else dont :)
  onDelete?: "CASCADE" | "SET NULL" | "NO ACTION" | "RESTRICT";
  onUpdate?: "CASCADE" | "NO ACTION" | "RESTRICT";
};

export type Column = {
  name: string;
  type: DataType;
  unique?: boolean;
  notNull?: boolean;
  default?: Data;
};

export type Table = {
  name: string;
  columns: Column[];
  pk?: string | string[];
  references?: ForeignKey[];
  metadata?: Record<string, unknown>;
};
