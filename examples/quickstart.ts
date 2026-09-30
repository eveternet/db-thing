import { Database, gte } from "../src/index.js";

const db = new Database({
  schema: [
    {
      name: "users",
      pk: "id",
      columns: [
        { name: "id", type: "number" },
        { name: "name", type: "text", notNull: true },
        { name: "age", type: "number" },
      ],
      indexes: [{ name: "by_name", columns: ["name"] }],
    },
  ],
});
try {
  db.table("users").insert([
    { id: 1, name: "Evie", age: 18 },
    { id: 2, name: "Axo", age: 20 },
  ]);
  console.log(db.table("users").filter({ name: "Evie" }));
  console.log(db.table("users").query(gte("age", 18)).orderBy("name").select("name").all());
  db.transaction((tx) => {
    tx.table("users").update({ age: 19 }, { id: 1 });
  });
  console.log(db.table("users").explain({ name: "Evie" }));
} finally {
  db.close();
}
