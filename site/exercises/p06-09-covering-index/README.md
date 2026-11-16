## Task

This is claim **H7** in miniature. Users log in with a **branch code** plus a **user code**, and the login query does a full-table scan:

```sql
SELECT user_id, status FROM app_users
WHERE branch_code = 'BR007' AND user_code = 'U00042';
```

`app_users` has 40,000 rows and only a primary key on `user_id`.

1. Run the starter and read the `EXPLAIN ANALYZE` output. Note the node type, the rows removed by the filter and the execution time.
2. Create **one index** that makes this an **Index Only Scan**. Branch-level lookups (`WHERE branch_code = ...` alone) should be able to use it too.
3. Run `EXPLAIN ANALYZE` again and write both timings in your journal. That is your interview number.

The checks look at the plan, at the index's leading column, and confirm the query still returns the right row.
