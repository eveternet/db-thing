import Database from "bun:sqlite";
import {
  Database_Operation,
  Data,
  ConditionNode,
  Modification_Pair,
  Table,
  Alter_Shenanigans,
  Column,
  DataType,
} from "@/types/types";

// Main purpose of this file: Take in a file system directory and provide
// functions to build DB operations in JSON form. Each function represents
// an action (select, update, etc.), not a string of SQL.

export class orm {
  private link_to_db_system: string;
  private instructions: Database_Operation[];

  constructor(link_to_db_system: string) {
    this.link_to_db_system = link_to_db_system;
    this.instructions = [];
  }

  // ---------------------------------------------------------------------------
  // Condition builders
  // ---------------------------------------------------------------------------

  // Comparisons
  public eq(column: string, value: Data): ConditionNode {
    return { type: "comparison", column, operator: "=", value };
  }

  public not_eq(column: string, value: Data): ConditionNode {
    return { type: "comparison", column, operator: "!=", value };
  }

  public less_than(column: string, value: Data): ConditionNode {
    return { type: "comparison", column, operator: "<", value };
  }

  public more_than(column: string, value: Data): ConditionNode {
    return { type: "comparison", column, operator: ">", value };
  }

  public less_than_eq(column: string, value: Data): ConditionNode {
    return { type: "comparison", column, operator: "<=", value };
  }

  public more_than_eq(column: string, value: Data): ConditionNode {
    return { type: "comparison", column, operator: ">=", value };
  }

  public like(column: string, value: Data): ConditionNode {
    return { type: "comparison", column, operator: "LIKE", value };
  }

  public between(column: string, value1: Data, value2: Data): ConditionNode {
    return {
      type: "comparison",
      column,
      operator: "BETWEEN",
      value: [value1, value2],
    };
  }

  // Logical
  public and(operands: ConditionNode[]): ConditionNode {
    return { type: "logical", operator: "AND", operands };
  }

  public or(operands: ConditionNode[]): ConditionNode {
    return { type: "logical", operator: "OR", operands };
  }

  public not(operand: ConditionNode): ConditionNode {
    return { type: "logical", operator: "NOT", operands: [operand] };
  }

  // ---------------------------------------------------------------------------
  // Operation builders (SELECT, UPDATE, INSERT, DELETE, CREATE, DROP, ALTER)
  // ---------------------------------------------------------------------------

  public select(columns: string[], from: string, where?: ConditionNode): Database_Operation {
    const op: Database_Operation = {
      operation: "SELECT",
      columns,
      table: from,
      ...(where && { conditions: where }),
    };
    this.instructions.push(op);
    return op;
  }

  public update(
    table: string,
    modify: Modification_Pair[],
    where?: ConditionNode,
  ): Database_Operation {
    const op: Database_Operation = {
      operation: "UPDATE",
      table,
      modify,
      ...(where && { conditions: where }),
    };
    this.instructions.push(op);
    return op;
  }

  public insert(table: string, data: object): Database_Operation {
    const op: Database_Operation = { operation: "INSERT", table, data };
    this.instructions.push(op);
    return op;
  }

  public delete(table: string, data: object): Database_Operation {
    const op: Database_Operation = { operation: "DELETE", table };
    this.instructions.push(op);
    return op;
  }

  public create_table(data: Table): Database_Operation {
    const op: Database_Operation = { operation: "CREATE TABLE", data };
    this.instructions.push(op);
    return op;
  }

  public drop_table(name: string): Database_Operation {
    const op: Database_Operation = { operation: "DROP TABLE", name };
    this.instructions.push(op);
    return op;
  }

  public alter_table(table: string, modification: Alter_Shenanigans): Database_Operation {
    const op: Database_Operation = {
      operation: "ALTER TABLE",
      name: table,
      modifications: modification,
    };
    this.instructions.push(op);
    return op;
  }

  // ---------------------------------------------------------------------------
  // Alter table helpers
  // ---------------------------------------------------------------------------

  public alter_add_column(col: Column): Alter_Shenanigans {
    return { operation: "ADD COLUMN", data: col };
  }

  public alter_drop_column(name: string): Alter_Shenanigans {
    return { operation: "DROP COLUMN", name };
  }

  public alter_rename_column(name: string, newname: string): Alter_Shenanigans {
    return { operation: "RENAME COLUMN", name, newname };
  }

  public alter_modify_datatype(name: string, type: DataType, def?: Data): Alter_Shenanigans {
    return { operation: "MODIFY DATATYPE COLUMN", name, type, default: def };
  }
}
