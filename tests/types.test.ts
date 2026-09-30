import { expect, test } from "bun:test";
import { Database } from "../src/index.js";

test("literal schemas infer table names, column names and scalar types", () => {
  const db = new Database({
    schema: [
      {
        name: "users",
        pk: "id",
        columns: [
          { name: "id", type: "number" },
          { name: "name", type: "text", notNull: true },
          { name: "active", type: "boolean" },
        ],
      },
    ],
  });
  try {
    const users = db.table("users");
    users.insert({ id: 1, name: "Evie", active: true });
    const first = users.query().select("id", "name").first()!;
    const id: number = first.id,
      name: string = first.name;
    expect(id).toBe(1);
    expect(name).toBe("Evie");
    // Compile-only negative cases: none of these statements run.
    if (false) {
      // @ts-expect-error nonexistent table
      db.table("books");
      // @ts-expect-error wrong scalar type
      users.insert({ id: "one" });
      // @ts-expect-error wrong update type
      users.update({ active: "yes" });
      // @ts-expect-error nonexistent column
      users.query().select("email");
      // @ts-expect-error projected row does not include active
      first.active;
      // @ts-expect-error nullable boolean cannot be assigned to boolean
      const active: boolean = users.all()[0].active;
    }
  } finally {
    db.close();
  }
});
