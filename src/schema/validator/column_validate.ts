import { validateType } from "@/types/datatype_validator";
import { Table, default_data_types, non_scalar_types } from "@/types/types";

type ValidationResult = [boolean, string];

export const validateColumns = (table: Table): ValidationResult => {
  if (!columnTypesValid(table)) {
    return [false, "Failed Column Types"];
  }

  if (!columnNameRules(table)) {
    return [false, "Failed Column Name Rules"];
  }

  if (!noDuplicateColumnNames(table)) {
    return [false, "Failed No Duplicate Column Names"];
  }

  if (!primaryKeyExists(table)) {
    return [false, "Failed PK Reference"];
  }

  if (!primaryKeyIsScalar(table)) {
    return [false, "Failed PK Scalable"];
  }

  if (!compositePrimaryKeyExists(table)) {
    return [false, "Failed Comp PK Test"];
  }

  if (!noDuplicateInCompositePrimaryKey(table)) {
    return [false, "Failed No Duplicate in Composite PK"];
  }

  if (!uniqueOnlyInScalarColumns(table)) {
    return [false, "Failed Unique Only In Scalar Columns"];
  }

  if (!defaultTypecheck(table)) {
    return [false, "Failed default typecheck"];
  }

  return [true, ""];
};

const columnTypesValid = (table: Table): boolean =>
  table.columns.every((column) => default_data_types.includes(column.type));

const columnNameRules = (table: Table): boolean => {
  const namePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
  return table.columns.every((column) => namePattern.test(column.name));
};

const noDuplicateColumnNames = (table: Table): boolean => {
  const columnNames = table.columns.map((column) => column.name);
  return new Set(columnNames).size === columnNames.length;
};

const primaryKeyExists = (table: Table): boolean => {
  const columnNames = table.columns.map((column) => column.name);
  if (!table.pk) return true;

  if (typeof table.pk === "string") {
    return columnNames.includes(table.pk);
  }

  return table.pk.every((key) => columnNames.includes(key));
};

const primaryKeyIsScalar = (table: Table): boolean => {
  if (!table.pk) return true;

  const isScalar = (colName: string): boolean => {
    const column = table.columns.find((c) => c.name === colName);
    if (!column) return true;
    return !non_scalar_types.includes(column.type);
  };

  if (Array.isArray(table.pk)) {
    return table.pk.every(isScalar);
  }

  return isScalar(table.pk);
};

const compositePrimaryKeyExists = (table: Table): boolean => {
  if (!table.pk) return true;
  if (typeof table.pk === "string") return true;

  return table.pk.length > 0;
};

const noDuplicateInCompositePrimaryKey = (table: Table): boolean => {
  if (!table.pk) return true;
  if (typeof table.pk === "string") return true;

  return new Set(table.pk).size === table.pk.length;
};

const uniqueOnlyInScalarColumns = (table: Table): boolean =>
  table.columns.every((column) => !(column.unique && non_scalar_types.includes(column.type)));

const defaultTypecheck = (table: Table): boolean => {
  for (const column of table.columns) {
    if (!("default" in column) || column.default === undefined) {
      continue;
    }

    if (column.type === "uuid") {
      if (typeof column.default === "boolean") {
        return true;
      }

      if (typeof column.default === "number") {
        return false;
      }

      if (!validateType("uuid", column.default)) {
        return false;
      }
    } else if (!validateType(column.type, column.default)) {
      return false;
    }
  }

  return true;
};
