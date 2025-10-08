import { describe, test, expect } from "vitest";
import { Table, Schema } from "./schema";

// Base Case Schemas: Tests all pass

const baseCaseSchemaOne: Table[] = [
  {
    name: "Users",
    columns: [
      {
        name: "user_id",
        type: "text",
        unique: true,
      },
      {
        name: "user_f_name",
        type: "text",
      },
      {
        name: "user_l_name",
        type: "text",
      },
      {
        name: "alive",
        type: "boolean",
      },
    ],
    pk: "user_id",
  },
  {
    name: "Books",
    columns: [
      {
        name: "book_id",
        type: "text",
        unique: true,
      },
      {
        name: "book_name",
        type: "text",
      },
    ],
    pk: "book_id",
  },
  {
    name: "BorrowHistory",
    columns: [
      {
        name: "borrow_id",
        type: "text",
        unique: true,
      },
      {
        name: "borrow_date",
        type: "date",
      },
      {
        name: "return_date",
        type: "date",
      },
      {
        name: "borrower",
        type: "text",
      },

      {
        name: "book_borrowed",
        type: "text",
      },
    ],
    pk: "borrow_id",
    references: [
      {
        targetTable: "Users",
        pairs: [
          {
            local: "borrower",
            away: "user_id",
          },
        ],
      },
      {
        targetTable: "Books",
        pairs: [
          {
            local: "book_borrowed",
            away: "book_id",
          },
        ],
      },
    ],
  },
];

function cloneSchema(tables: Table[]): Table[] {
  return JSON.parse(JSON.stringify(tables));
}

// Alternative test cases lets go!

// No Tables
const altSchemaOne: Table[] = [];

// Duplicate table names
let altSchemaTwo: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaTwo[1].name = "Users";

// Table Name Rules (No Space)
let altSchemaThree: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaThree[0].name = "Us ers";

// No Reserved Names -- 1
let altSchemaFour: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaFour[0].name = "_table";

// No Reserved Names -- 2
let altSchemaFive: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaFive[0].columns[0].name = "_pk";

// Column Types
let altSchemaSix: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaSix[0].columns[0].type = "booleann" as any;

// Table has Columns
let altSchemaSeven: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaSeven[0].columns = [];

// Duplicate Column Names
let altSchemaEight: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaEight[0].columns[1].name = "user_id";

// PK Exists
let altSchemaNine: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaNine[0].pk = "usered_id";

// Unique only in scalar columns
let altSchemaTen: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaTen[0].columns[3].unique = true;

// FK Pairs must exist
let altSchemaEleven: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaEleven[2].references![0].pairs = [];

// Validate FK Reference Table Exists
let altSchemaTwelve: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaTwelve.reverse().pop();

// Validate FK Reference Table Exists
let altSchemaThirteen: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaThirteen[0].columns.reverse().pop();
altSchemaThirteen[0].pk = "";

// FK Reference and Local Type should be the same
let altSchemaFourteen: Table[] = cloneSchema(baseCaseSchemaOne);
altSchemaFourteen[0].columns[0].type = "uuid";

function validator(schema: Table[]): [boolean, string] {
  const instance = new Schema(schema);
  return instance.validateSchema();
}

describe("Schema validator — Test Cases", () => {
  test("Base schema 1", () => {
    expect(validator(baseCaseSchemaOne)).toStrictEqual([true, "Success!"]);
  });
  test("Alternative Schema 1 - No Tables", () => {
    expect(validator(altSchemaOne)).toStrictEqual([false, "Failed Tables Exist"]);
  });
  test("Alternative Schema 2 - Duplicate table names", () => {
    expect(validator(altSchemaTwo)).toStrictEqual([false, "Failed No Duplicate Table Names"]);
  });
  test("Alternative Schema 3 - Table Name Rules (No Space)", () => {
    expect(validator(altSchemaThree)).toStrictEqual([false, "Failed Table Names Rules"]);
  });
  test("Alternative Schema 4 - No Reserved Names (table)", () => {
    expect(validator(altSchemaFour)).toStrictEqual([false, "Failed No Reserved Names Usage"]);
  });
  test("Alternative Schema 5 - No Reserved Names (column)", () => {
    expect(validator(altSchemaFive)).toStrictEqual([false, "Failed No Reserved Names Usage"]);
  });
  test("Alternative Schema 6 - Column Types", () => {
    expect(validator(altSchemaSix)).toStrictEqual([false, "Failed Column Types"]);
  });
  test("Alternative Schema 7 - Table has Columns", () => {
    expect(validator(altSchemaSeven)).toStrictEqual([false, "Failed Table Has Columns"]);
  });
  test("Alternative Schema 8 - Duplicate Column Names", () => {
    expect(validator(altSchemaEight)).toStrictEqual([false, "Failed No Duplicate Column Names"]);
  });
  test("Alternative Schema 9 - PK Exists", () => {
    expect(validator(altSchemaNine)).toStrictEqual([false, "Failed PK Existence"]);
  });
  test("Alternative Schema 10 - Unique only in scalar columns", () => {
    expect(validator(altSchemaTen)).toStrictEqual([false, "Failed Unique Only In Scalar Columns"]);
  });
  test("Alternative Schema 11 - FK Pairs must exist", () => {
    expect(validator(altSchemaEleven)).toStrictEqual([false, "Failed FK Pairs Exist"]);
  });
  test("Alternative Schema 12 - Validate FK Reference Table Exists", () => {
    expect(validator(altSchemaTwelve)).toStrictEqual([false, "Failed FK Reference Table Exists"]);
  });
  test("Alternative Schema 13 - Validate FK Reference Column Exists", () => {
    expect(validator(altSchemaThirteen)).toStrictEqual([
      false,
      "Failed FK Reference Column Exists",
    ]);
  });
  test("Alternative Schema 14 - FK Reference and Local Type should be the same", () => {
    expect(validator(altSchemaFourteen)).toStrictEqual([
      false,
      "Failed FK Pairs Have Matching Types",
    ]);
  });
});
