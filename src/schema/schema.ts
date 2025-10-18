import { Table } from "@/types/types";

import { validateTables } from "@/schema/validator/table_validate";
import { validateColumns } from "@/schema/validator/column_validate";
import { validateReferences } from "@/schema/validator/reference_validate";

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

    return [true, "Success!"];
  }
}
