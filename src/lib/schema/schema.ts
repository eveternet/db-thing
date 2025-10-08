import { DataType, Table, ForeignKey, Pair } from "../types";
import { validateType } from "../datatype_validator";

export class Schema {
  private tables: Table[];
  private dataTypeArray: DataType[] = [
    "number",
    "text",
    "boolean",
    "date",
    "uuid",
    "jsonb",
    "time",
  ];
  constructor(schmea: Table[]) {
    this.tables = schmea;
  }

  public validateSchema(): [boolean, string] {
    if (!this.validateNoReservedNamesUsage(this.tables)) {
      return [false, "Failed No Reserved Names Usage"];
    }
    if (!this.validateTablesExist(this.tables)) {
      return [false, "Failed Tables Exist"];
    }
    if (!this.validateNoDuplicateTableNames(this.tables)) {
      return [false, "Failed No Duplicate Table Names"];
    }
    for (const table of this.tables) {
      if (!this.validateTableNameRules(table)) {
        return [false, "Failed Table Names Rules"];
      }
      if (!this.validateColumnTypes(table)) {
        return [false, "Failed Column Types"];
      }
      if (!this.validateTableHasColumns(table)) {
        return [false, "Failed Table Has Columns"];
      }
      if (!this.validateNoDuplicateColumnNames(table)) {
        return [false, "Failed No Duplicate Column Names"];
      }
      if (!this.validatePkExistence(table)) {
        return [false, "Failed PK Existence"];
      }
      if (!this.validateUniqueOnlyInScalarColumns(table)) {
        return [false, "Failed Unique Only In Scalar Columns"];
      }
      if (!this.validateDefaultTypecheck(table)) {
        return [false, "Default failed typecheck"];
      }
      if (table.references) {
        for (const reference of table.references) {
          if (!this.validateFkPairsExist(reference)) {
            return [false, "Failed FK Pairs Exist"];
          }
          for (const pair of reference.pairs) {
            if (!this.validateFkReferenceTableExists(reference)) {
              return [false, "Failed FK Reference Table Exists"];
            }
            if (!this.validateFkReferenceColumnExists(pair, reference)) {
              return [false, "Failed FK Reference Column Exists"];
            }
            if (!this.validateFkPairsHaveMatchingTypes(pair, reference, table)) {
              return [false, "Failed FK Pairs Have Matching Types"];
            }
          }
        }
      }
    }
    return [true, "Success!"];
  }

  private validateTablesExist(tables: Table[]): boolean {
    if (this.tables.length === 0) {
      return false;
    }
    return true;
  }

  private validateNoDuplicateTableNames(tables: Table[]): boolean {
    let tableNames: string[] = this.tables.map((table) => table.name);
    if (new Set(tableNames).size !== tableNames.length) {
      return false;
    }
    return true;
  }

  private validateTableNameRules(table: Table): boolean {
    if (table.name.includes(" ")) {
      return false;
    }
    return true;
  }

  private validateNoReservedNamesUsage(tables: Table[]): boolean {
    let reservedNames = ["_pk", "_table"]; // I forgot the rest
    for (const table of this.tables) {
      if (reservedNames.includes(table.name)) {
        return false;
      }
      for (const column of table.columns) {
        if (reservedNames.includes(column.name)) {
          return false;
        }
      }
    }
    return true;
  }

  private validateColumnTypes(table: Table): boolean {
    for (const column of table.columns) {
      if (!this.dataTypeArray.includes(column.type)) {
        return false;
      }
    }
    return true;
  }

  private validateTableHasColumns(table: Table): boolean {
    if (table.columns.length === 0) {
      return false;
    }
    return true;
  }

  private validateNoDuplicateColumnNames(table: Table): boolean {
    let columnsName = table.columns.map((column) => column.name);
    if (new Set(columnsName).size !== columnsName.length) {
      return false;
    }
    return true;
  }

  private validatePkExistence(table: Table): boolean {
    let columnsName = table.columns.map((column) => column.name);
    if (table.pk) {
      if (typeof table.pk === "string") {
        if (!columnsName.includes(table.pk)) {
          return false;
        }
      } else {
        for (const key of table.pk) {
          if (!columnsName.includes(key)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private validateUniqueOnlyInScalarColumns(table: Table): boolean {
    let nonScalarTypes: DataType[] = ["boolean", "date", "time"];
    for (const column of table.columns) {
      if (column.unique && nonScalarTypes.includes(column.type)) {
        return false;
      }
    }
    return true;
  }

  private validateDefaultTypecheck(table: Table): boolean {
    for (const column of table.columns) {
      if (column.default) {
        if (column.type === "uuid") {
          // Check 1: If bool
          if (typeof column.default === "boolean") {
            return true;
          }
          // Check 2: Ruling out the third option
          if (typeof column.default === "number") {
            return false;
          }
          return validateType("uuid", column.default);
        } else {
          return validateType(column.type, column.default);
        }
      }
    }
    return true;
  }

  private validateFkPairsExist(reference: ForeignKey): boolean {
    if (reference.pairs.length === 0) {
      return false;
    }
    return true;
  }

  private validateFkReferenceTableExists(reference: ForeignKey): boolean {
    let tableNames: string[] = this.tables.map((table) => table.name);
    if (!tableNames.includes(reference.targetTable)) {
      return false;
    }
    return true;
  }

  private validateFkReferenceColumnExists(pair: Pair, reference: ForeignKey): boolean {
    let tableNames: string[] = this.tables.map((table) => table.name);
    let indexOf = tableNames.indexOf(reference.targetTable);
    let referencingTable = this.tables[indexOf];
    let columnNamesOfReferencedTable = referencingTable.columns.map((column) => column.name);

    if (typeof pair.away === "string") {
      if (!columnNamesOfReferencedTable.includes(pair.away)) {
        return false;
      }
    }
    return true;
  }

  private validateFkPairsHaveMatchingTypes(
    pair: Pair,
    reference: ForeignKey,
    table: Table,
  ): boolean {
    let tableNames: string[] = this.tables.map((table) => table.name);
    let indexOf = tableNames.indexOf(reference.targetTable);
    let referencingTable = this.tables[indexOf];
    let columnNamesOfReferencedTable = referencingTable.columns.map((column) => column.name);

    let indexOfLocalColumns = table.columns.map((column) => column.name).indexOf(pair.local);
    let localColumnType = table.columns[indexOfLocalColumns].type;

    // Get the type of away column
    let indexOfAwayColumns = columnNamesOfReferencedTable.indexOf(pair.away);
    let awayColumnType = referencingTable.columns[indexOfAwayColumns].type;

    if (localColumnType !== awayColumnType) {
      return false;
    }
    return true;
  }
}
