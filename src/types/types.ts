// -----------------------------------------------------------------------------
// Core Data Types
// -----------------------------------------------------------------------------

export type DataType = "boolean" | "date" | "jsonb" | "number" | "text" | "time" | "uuid";

export type Data = string | number | boolean | Record<string, unknown> | unknown[] | null;

// Default type groupings
export const default_data_types: DataType[] = [
  "boolean",
  "date",
  "jsonb",
  "number",
  "text",
  "time",
  "uuid",
];

export const non_scalar_types: DataType[] = ["boolean", "date", "time"];

// -----------------------------------------------------------------------------
// Schema Definitions
// -----------------------------------------------------------------------------

export type Pair = {
  local: string;
  away: string;
};

export type ForeignKey = {
  targetTable: string;
  pairs: Pair[]; // Composite = multiple pairs
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

// -----------------------------------------------------------------------------
// Condition Tree (WHERE clause representation)
// -----------------------------------------------------------------------------

type Comparison_Most = {
  type: "comparison";
  column: string;
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "LIKE";
  value?: Data;
};

type Comparison_In = {
  type: "comparison";
  column: string;
  operator: "IN";
  value?: Data[];
};

type Comparison_Between = {
  type: "comparison";
  column: string;
  operator: "BETWEEN";
  value?: [Data, Data];
};

type Logical_Comparison_And_Or = {
  type: "logical";
  operator: "AND" | "OR";
  operands: ConditionNode[];
};

type Logical_Comparison_Not = {
  type: "logical";
  operator: "NOT";
  operands: [ConditionNode];
};

export type ConditionNode =
  | Comparison_Most
  | Comparison_In
  | Comparison_Between
  | Logical_Comparison_And_Or
  | Logical_Comparison_Not;

// -----------------------------------------------------------------------------
// Common Utility Types
// -----------------------------------------------------------------------------

export type Modification_Pair = {
  column: string;
  value: Data;
};

// -----------------------------------------------------------------------------
// Operation: SELECT | UPDATE | INSERT | DELETE
// -----------------------------------------------------------------------------

type Select_Function = {
  operation: "SELECT";
  columns: string[];
  table: string;
  conditions?: ConditionNode;
};

type Update_Function = {
  operation: "UPDATE";
  table: string;
  modify: Modification_Pair[];
  conditions?: ConditionNode;
};

type Insert_Function = {
  operation: "INSERT";
  table: string;
  data: object;
};

type Delete_Function = {
  operation: "DELETE";
  table: string;
  conditions?: ConditionNode;
};

// -----------------------------------------------------------------------------
// Operation: CREATE | DROP TABLE
// -----------------------------------------------------------------------------

type Create_Table_Function = {
  operation: "CREATE TABLE";
  data: Table;
};

type Drop_Table_Function = {
  operation: "DROP TABLE";
  name: string;
};

// -----------------------------------------------------------------------------
// Operation: ALTER TABLE
// -----------------------------------------------------------------------------

type Alter_Table_Add_Column = {
  operation: "ADD COLUMN";
  data: Column;
};

type Alter_Table_Drop_Column = {
  operation: "DROP COLUMN";
  name: string;
};

type Alter_Table_Rename_Column = {
  operation: "RENAME COLUMN";
  name: string;
  newname: string;
};

type Alter_Table_Datatype_Column = {
  operation: "MODIFY DATATYPE COLUMN";
  name: string;
  type: DataType;
  default?: Data;
};

// Combine the alter actions into one union
export type Alter_Shenanigans =
  | Alter_Table_Add_Column
  | Alter_Table_Drop_Column
  | Alter_Table_Rename_Column
  | Alter_Table_Datatype_Column;

type Alter_Table_Function = {
  operation: "ALTER TABLE";
  name: string;
  modifications: Alter_Shenanigans;
};

// -----------------------------------------------------------------------------
// Top-Level Database Operation Union
// -----------------------------------------------------------------------------

export type Database_Operation =
  | Select_Function
  | Update_Function
  | Insert_Function
  | Delete_Function
  | Create_Table_Function
  | Drop_Table_Function
  | Alter_Table_Function;
