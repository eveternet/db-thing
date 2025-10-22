import type { ForeignKey, Pair, Table } from "@/types/types";

type ValidationResult = [boolean, string];

export const validateReferences = (tables: Table[], table: Table): ValidationResult => {
  if (!table.references) {
    return [true, ""];
  }

  for (const reference of table.references) {
    if (!fkPairsExist(reference)) {
      return [false, "Failed FK Pairs Exist"];
    }

    if (!fkReferenceTableExists(reference, tables)) {
      return [false, "Failed FK Reference Table Exists"];
    }

    for (const pair of reference.pairs) {
      if (!fkReferenceColumnExists(pair, reference, tables)) {
        return [false, "Failed FK Reference Column Exists"];
      }

      if (!fkLocalColumnExists(pair, table)) {
        return [false, "Failed FK Local Column Exists"];
      }

      if (!fkPairsHaveMatchingTypes(pair, reference, table, tables)) {
        return [false, "Failed FK Pairs Have Matching Types"];
      }
    }
  }

  return [true, ""];
};

export const fkPairsExist = (reference: ForeignKey): boolean => reference.pairs.length > 0;

export const fkReferenceTableExists = (reference: ForeignKey, tables: Table[]): boolean => {
  const tableNames = tables.map((table) => table.name);
  return tableNames.includes(reference.targetTable);
};

export const fkReferenceColumnExists = (
  pair: Pair,
  reference: ForeignKey,
  tables: Table[],
): boolean => {
  const tableNames = tables.map((table) => table.name);
  const indexOf = tableNames.indexOf(reference.targetTable);
  if (indexOf === -1) return false;

  const referencingTable = tables[indexOf];
  const columnNamesOfReferencedTable = referencingTable.columns.map((column) => column.name);

  return columnNamesOfReferencedTable.includes(pair.away);
};

export const fkLocalColumnExists = (pair: Pair, table: Table): boolean => {
  const localColumnNameList = table.columns.map((column) => column.name);
  return localColumnNameList.includes(pair.local);
};

export const fkPairsHaveMatchingTypes = (
  pair: Pair,
  reference: ForeignKey,
  table: Table,
  tables: Table[],
): boolean => {
  const tableNames = tables.map((tbl) => tbl.name);
  const targetIndex = tableNames.indexOf(reference.targetTable);
  if (targetIndex === -1) return false;

  const referencingTable = tables[targetIndex];
  const columnNamesOfReferencedTable = referencingTable.columns.map((column) => column.name);

  const indexOfLocalColumns = table.columns.map((column) => column.name).indexOf(pair.local);
  if (indexOfLocalColumns === -1) return false;

  const localColumnType = table.columns[indexOfLocalColumns].type;

  const indexOfAwayColumns = columnNamesOfReferencedTable.indexOf(pair.away);
  if (indexOfAwayColumns === -1) return false;

  const awayColumnType = referencingTable.columns[indexOfAwayColumns].type;

  return localColumnType === awayColumnType;
};
