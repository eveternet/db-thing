import { Table } from "@/types/types";

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

  if (!cycleFksBanned(tables)) {
    return [false, "Failed Cycle FKs"];
  }

  return [true, ""];
};

const tablesExist = (tables: Table[]): boolean => tables.length > 0;

const noDuplicateTableNames = (tables: Table[]): boolean => {
  const tableNames = tables.map((table) => table.name);
  return new Set(tableNames).size === tableNames.length;
};

const tableNameRules = (table: Table): boolean => {
  const namePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
  return namePattern.test(table.name);
};

const tableHasColumns = (table: Table): boolean => table.columns.length > 0;

const cycleFksBanned = (tables: Table[]): boolean => {
  const localColumns = new Set(
    tables.flatMap((table) =>
      (table.references ?? []).flatMap((reference) =>
        reference.pairs.map((pair) => `${table.name}.${pair.local}`),
      ),
    ),
  );

  for (const table of tables) {
    for (const reference of table.references ?? []) {
      for (const pair of reference.pairs) {
        const awayPair = `${reference.targetTable}.${pair.away}`;
        if (localColumns.has(awayPair)) {
          return false;
        }
      }
    }
  }

  return true;
};
