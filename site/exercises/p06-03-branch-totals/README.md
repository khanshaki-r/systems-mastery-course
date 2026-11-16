## Task

For each branch, count the **live** loans (status `APPROVED` or `DISBURSED`) and add up their amounts. Show only branches with **at least 3** live loans.

Columns, in order: `branch_code`, the loan count, the total amount. Biggest total first; break ties by `branch_code`.

A branch with many pending or rejected loans must **not** qualify. That is the trap the test is built around: filter the rows before you count them.

Then try `EXPLAIN ANALYZE` on your query to see the `HashAggregate` or `GroupAggregate` node that does the grouping (module 6.10).
