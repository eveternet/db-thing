import { describe, test, expect } from "bun:test";
import { Schema } from "@/schema/schema";
import { Table, Column } from "@/types/types";

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

const circularBaseCase: Table[] = [
  {
    name: "table1",
    columns: [
      {
        name: "one",
        type: "text",
      },
      {
        name: "two",
        type: "text",
      },
    ],
    references: [
      {
        targetTable: "table3",
        pairs: [
          {
            local: "two",
            away: "one",
          },
        ],
      },
    ],
  },
  {
    name: "table2",
    columns: [
      {
        name: "one",
        type: "text",
      },
      {
        name: "two",
        type: "text",
      },
    ],
    references: [
      {
        targetTable: "table1",
        pairs: [
          {
            local: "two",
            away: "one",
          },
        ],
      },
    ],
  },
  {
    name: "table3",
    columns: [
      {
        name: "one",
        type: "text",
      },
      {
        name: "two",
        type: "text",
      },
    ],
    references: [
      {
        targetTable: "table2",
        pairs: [
          {
            local: "two",
            away: "one",
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
type testCase = {
  name: string;
  schema: Table[] | (() => Table[]);
  result: [boolean, string];
};

let testCases: testCase[] = [];

testCases.push({
  name: "Base Case",
  schema: baseCaseSchemaOne,
  result: [true, "Success!"],
});

testCases.push({
  name: "No Tables Test",
  schema: [],
  result: [false, "Failed Tables Exist"],
});

testCases.push({
  name: "Duplicate Table Names Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[1].name = "Users";
    return s;
  },
  result: [false, "Failed No Duplicate Table Names"],
});

testCases.push({
  name: "Table Name Rules Test 1 - Space in Table Name Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].name = "Us ers";
    return s;
  },
  result: [false, "Failed Table Names Rules"],
});

testCases.push({
  name: "Table Name Rules Test 2 - Reserved in Table Name Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].name = "_table";
    s[2].references![0].targetTable = "_table";
    return s;
  },
  result: [false, "Failed Table Names Rules"],
});

testCases.push({
  name: "Table has Columns Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns = [];
    return s;
  },
  result: [false, "Failed Table Has Columns"],
});

testCases.push({
  name: "Invalid Column Type Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns[0].type = "booleann" as any;
    return s;
  },
  result: [false, "Failed Column Types"],
});

testCases.push({
  name: "Column Name Rules Test 1 - Space in Column Name Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns[1].name = "tablenfeiwof fewino";
    return s;
  },
  result: [false, "Failed Column Name Rules"],
});

testCases.push({
  name: "Column Name Rules Test 2 - Reserved in Column Name Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns[1].name = "_pk";
    return s;
  },
  result: [false, "Failed Column Name Rules"],
});

testCases.push({
  name: "Duplicate Column Names Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns[1].name = "user_id";
    return s;
  },
  result: [false, "Failed No Duplicate Column Names"],
});

testCases.push({
  name: "PK Reference Exists Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].pk = "usered_id";
    return s;
  },
  result: [false, "Failed PK Reference"],
});

testCases.push({
  name: "PK is using Scalar Values Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns[0].type = "boolean";
    return s;
  },
  result: [false, "Failed PK Scalable"],
});

testCases.push({
  name: "PK Composite with 0 Values Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].pk = [];
    return s;
  },
  result: [false, "Failed Comp PK Test"],
});

testCases.push({
  name: "PK Composite No Duplicates Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].pk = ["user_id", "user_id"];
    return s;
  },
  result: [false, "Failed No Duplicate in Composite PK"],
});

testCases.push({
  name: "Unique Scalable Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns[3].unique = true;
    return s;
  },
  result: [false, "Failed Unique Only In Scalar Columns"],
});

testCases.push({
  name: "Default Correct Type Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns[3].default = "true";
    return s;
  },
  result: [false, "Failed default typecheck"],
});

testCases.push({
  name: "FK Pairs Exist Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[2].references![0].pairs = [];
    return s;
  },
  result: [false, "Failed FK Pairs Exist"],
});

testCases.push({
  name: "FK Reference Table Exists Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s.reverse().pop();
    return s;
  },
  result: [false, "Failed FK Reference Table Exists"],
});

testCases.push({
  name: "FK Reference Column Exists Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns.reverse().pop();
    s[0].pk = "";
    return s;
  },
  result: [false, "Failed FK Reference Column Exists"],
});

testCases.push({
  name: "FK Local Column Exists Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[2].columns.pop();
    return s;
  },
  result: [false, "Failed FK Local Column Exists"],
});

testCases.push({
  name: "FK Reference And Local Same Type Test",
  schema: () => {
    const s = cloneSchema(baseCaseSchemaOne);
    s[0].columns[0].type = "uuid";
    return s;
  },
  result: [false, "Failed FK Pairs Have Matching Types"],
});

// Circular FKs
testCases.push({
  name: "Circular FK - 1: Pass",
  schema: circularBaseCase,
  result: [true, "Success!"],
});

testCases.push({
  name: "Circular FK - 2: Circles",
  schema: () => {
    const s = cloneSchema(circularBaseCase);
    s[0].references![0].pairs[0].away = "two";
    return s;
  },
  result: [false, "Failed Cycle FKs"],
});

testCases.push({
  name: "Weak Table - No PK Test",
  schema: [
    {
      name: "sillytable",
      columns: [
        {
          name: "Meow",
          type: "text",
        },
      ],
    },
  ],
  result: [true, "Success!"],
});

// make 10 columns named "col1"..."col10"
const makeColumns = (n: number): Column[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `col${i + 1}`,
    type: "text" as const,
  }));

// make n tables, each with 10 columns
const makeTables = (n: number, colsPerTable = 10): Table[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `table_${i + 1}`,
    columns: makeColumns(colsPerTable),
  }));

testCases.push({
  name: "300 Tables, 10 Columns",
  schema: makeTables(300, 10),
  result: [true, "Success!"],
});

function validator(schema: Table[]): [boolean, string] {
  const instance = new Schema(schema);
  return instance.validateSchema();
}

describe("Schema validator — Test Cases", () => {
  for (const testCase of testCases) {
    test(testCase.name, () => {
      // unwrap if the schema is a function
      const schemaData =
        typeof testCase.schema === "function"
          ? (testCase.schema as () => Table[])()
          : (testCase.schema as Table[]);

      expect(validator(schemaData)).toStrictEqual(testCase.result);
    });
  }
});
