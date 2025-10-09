# DB-Thing - A ORM and DBMS Built into 1 Project

No, this isn't necessary.
No, this isn't useful.

This is my little experiment that I am starting to build that began with

> "What if I made a DBMS that doesn't use strings as its syntax?"

While that is the core idea of this project, I also threw in a few of my own ideas in this project.

1. Since this is function based, I can make this both an ORM and DBMS - The functions are the same so I can effectively "expose" it to the ORM.

## Next steps for DB-Thing:

- [x] Deeper testing for `Schema.validateSchema()` -- Current tests only indicate this works for base cases
- [ ] Creating migrations for the schema and creating files for the DBMS to read and write
- [ ] Creating secondary indexes to allow the faster read of data
- [ ] Creating integrity systems to ensure both the main and secondary indexes are accurate
- [ ] Creating read systems using functions - mimicing SQL functions like `SELECT`, `WHERE` and SQL operators
- [ ] Create write and delete systems like SQL `WRITE` and `DELETE`
- [ ] Convert it into an API for DB-Thing as a Service (fellow joke project for db hosting)?

## To run what exists (why would you)

1. Clone the project
2. Do `pnpm install` (we have like 1 non-base next dependecy)
3. Do `pnpm test` or `pnpm test --watch` to run my 1 test file and see a all tests pass

## License (is this how a readme is supposed to flow?)

None - why would you want to use it.
I suppose the license is do whatever you want with my files - I don't care
