This file should explain how db-thing thinks about files.

1. The whole database exists in 1 folder.
2. The folder should include the following files
   - A subfolder for each table using the table name
     - E.g. `users`
   - `schema.json`
   - `db.wal` - write ahead log files
3. Each table subfolder should include the tables json, as well as each secondary index file in this format:
   - `_table.json` for the actual table
   - Each `_table.json` file is an array of record objects, each with an internal `_pk` key.
   - `(columnname).json` for the secondary indexes, where columnname is the actual name of the column
