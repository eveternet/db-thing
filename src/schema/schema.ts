import { Table } from "../types/types.js";

import { validateTables } from "./validator/table_validate.js";
import { validateColumns } from "./validator/column_validate.js";
import { validateReferences } from "./validator/reference_validate.js";
import { assertSchema } from "../dbms/catalog.js";

export class Schema {
  private tables: Table[];

  constructor(schema: Table[]) {
    this.tables = schema;
  }

  public validateSchema(): [boolean, string] {
    const [tablesValid, tablesMessage] = validateTables(this.tables);
    if (!tablesValid) {
      return [false, tablesMessage];
    }

    for (const table of this.tables) {
      const [columnsValid, columnsMessage] = validateColumns(table);
      if (!columnsValid) {
        return [false, columnsMessage];
      }

      const [referencesValid, referencesMessage] = validateReferences(this.tables, table);
      if (!referencesValid) {
        return [false, referencesMessage];
      }
    }

    try {
      assertSchema(this.tables);
    } catch (e) {
      return [false, (e as Error).message];
    }
    return [true, "Success!"];
  }
}
