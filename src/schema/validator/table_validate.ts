import { Table } from "../../types/types.js";

type ValidationResult = [boolean, string];

export const validateTables = (tables: Table[]): ValidationResult => {
  if (!tablesExist(tables)) {
    return [false, "Failed Tables Exist"];
  }

  if (!noDuplicateTableNames(tables)) {
    return [false, "Failed No Duplicate Table Names"];
  }

  for (const table of tables) {
    if (!tableNameRules(table)) {
      return [false, "Failed Table Names Rules"];
    }

    if (!tableHasColumns(table)) {
      return [false, "Failed Table Has Columns"];
    }
  }

  return [true, ""];
};

export const tablesExist = (tables: Table[]): boolean => tables.length > 0;

export const noDuplicateTableNames = (tables: Table[]): boolean => {
  const tableNames = tables.map((table) => table.name);
  return new Set(tableNames).size === tableNames.length;
};

export const tableNameRules = (table: Table): boolean => {
  const namePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
  return namePattern.test(table.name);
};

export const tableHasColumns = (table: Table): boolean => table.columns.length > 0;
